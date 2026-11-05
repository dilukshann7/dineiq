import time
from threading import RLock

from fastapi import HTTPException
from sqlmodel import Session, select

from app.auth.service import record_activity
from app.calibration.contracts import Calibration, defaults
from app.models.calibration import ActiveCalibration, CalibrationRevision
from app.models.monitoring import TableSnapshot


class CalibrationService:
    def __init__(self, engine, settings, monitor=None):
        self.engine = engine
        self.monitor = monitor
        self.lock = monitor.lock if monitor else RLock()
        self.defaults = defaults(settings)

    def current(self, db):
        # All readers that may commit evidence take this lock through commit.
        pointer = db.exec(
            select(ActiveCalibration).where(ActiveCalibration.id == 1).with_for_update()
        ).one()
        if pointer.revision_id is None:
            revision = CalibrationRevision(
                settings=self.defaults.model_dump(), created_at=time.time()
            )
            db.add(revision)
            db.flush()
            pointer.revision_id = revision.id
            db.add(pointer)
            db.flush()
        row = db.get(CalibrationRevision, pointer.revision_id)
        return row.id, Calibration.model_validate(row.settings)

    def snapshot(self):
        with Session(self.engine) as db:
            result = self.current(db)
            db.commit()
            return result

    def public(self):
        revision, settings = self.snapshot()
        return {
            "revision": revision,
            "settings": settings.model_dump(),
            "defaults": self.defaults.model_dump(),
            "controls": Calibration.model_json_schema()["properties"],
        }

    def apply(self, data, actor):
        with self.lock, Session(self.engine) as db:
            revision, _ = self.current(db)
            if revision != data.expected_revision:
                raise HTTPException(409, "Calibration changed. Reload settings before applying.")
            saved = CalibrationRevision(
                settings=data.settings.model_dump(),
                actor_id=actor.id,
                actor_username=actor.username,
                created_at=time.time(),
            )
            db.add(saved)
            db.flush()
            pointer = db.get(ActiveCalibration, 1)
            pointer.revision_id = saved.id
            db.add(pointer)
            for row in db.exec(select(TableSnapshot)).all():
                row.payload = {
                    **row.payload,
                    "occupancy": "unknown",
                    "count": None,
                    "cleanliness": "unknown",
                    "valid": False,
                    "evidence": [],
                    "calibration_revision": saved.id,
                    "reason": "Calibration changed; confirming observations",
                }
                db.add(row)
            record_activity(db, actor, "calibration_applied", data={"revision": saved.id})
            applied_revision = saved.id
            db.commit()
            if self.monitor:
                for machines in self.monitor.machines.values():
                    for machine in machines.values():
                        machine.recalibrate(data.settings, applied_revision)
                self.monitor.capture.trackers.clear()
        return self.public()

    def history(self, before=None, limit=20):
        with Session(self.engine) as db:
            query = select(CalibrationRevision).order_by(CalibrationRevision.id.desc())
            if before is not None:
                query = query.where(CalibrationRevision.id < before)
            rows = db.exec(query.limit(limit + 1)).all()
            return {
                "revisions": [
                    {
                        "revision": row.id,
                        "settings": row.settings,
                        "actor_username": row.actor_username,
                        "created_at": row.created_at,
                    }
                    for row in rows[:limit]
                ],
                "next_before": rows[limit - 1].id if len(rows) > limit else None,
            }
