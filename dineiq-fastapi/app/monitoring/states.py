import copy
from typing import TYPE_CHECKING

from sqlmodel import Session, select

from app.models.monitoring import CameraLayout, CaptureSession, MonitoringEvent, TableSnapshot
from app.monitoring.errors import MonitorError
from app.monitoring.time import timestamp

if TYPE_CHECKING:
    from app.monitoring.service import MonitoringService


class TableStateService:
    def __init__(self, monitor: "MonitoringService"):
        self.monitor = monitor

    def _unknown(self, db, camera_id, reason):
        monitor = self.monitor
        for row in db.exec(select(TableSnapshot).where(TableSnapshot.camera_id == camera_id)).all():
            changed = (
                row.payload.get("occupancy") != "unknown"
                or row.payload.get("cleanliness") != "unknown"
                or row.payload.get("valid")
                or row.payload.get("reason") != reason
            )
            row.payload = {
                **row.payload,
                "occupancy": "unknown",
                "count": None,
                "cleanliness": "unknown",
                "valid": False,
                "reason": reason,
                "evidence": [],
                "updated_at": (
                    timestamp(monitor.clock()) if changed else row.payload.get("updated_at")
                ),
            }
            db.add(row)

    def _write_state(
        self, db, camera_id, table, state, session_id, observed_at, *, emit=True, arrival_at=None
    ):
        monitor = self.monitor
        row = db.get(TableSnapshot, (camera_id, table["id"]))
        previous = row.payload if row else {}
        keys = ("count", "occupancy", "cleanliness", "valid", "manual", "evidence")
        changed = any(previous.get(key) != state[key] for key in keys)
        payload = {
            **state,
            "id": table["id"],
            "name": table["name"],
            "observed_at": timestamp(observed_at)
            if observed_at is not None
            else previous.get("observed_at"),
            "updated_at": timestamp(monitor.clock()) if changed else previous.get("updated_at"),
        }
        if row is None:
            row = TableSnapshot(camera_id=camera_id, table_key=table["id"], payload=payload)
        else:
            row.payload = payload
        db.add(row)
        if changed and emit:
            monitor._event(db, camera_id, "table_state", payload, table["id"], session_id)
        monitor.alerts.synchronize(db, camera_id, table, state, session_id, arrival_at)
        return monitor.alerts.enrich(db, payload, session_id)

    def states(self, camera_id="main"):
        monitor = self.monitor
        with monitor.lock:
            monitor._initialize()
            monitor.watchdog()
            with Session(monitor.engine) as db:
                layout = monitor._latest(db, camera_id)
                if layout is None:
                    return {"tables": [], "recalibration_required": False}
                keys = {table["id"] for table in monitor._tables(db, layout)}
                revision, calibration = monitor.calibration.current(db)
                active = db.exec(
                    select(CaptureSession).where(CaptureSession.active_camera == camera_id)
                ).first()
                states = [
                    monitor.alerts.enrich(db, row.payload, active.id if active else None)
                    for row in db.exec(
                        select(TableSnapshot).where(TableSnapshot.camera_id == camera_id)
                    ).all()
                    if row.table_key in keys
                ]
                return {"tables": states, "recalibration_required": layout.needs_reconfirmation}

    def history(self, camera_id="main", table_id=None, before=None, limit=20):
        monitor = self.monitor
        with monitor.lock:
            monitor._initialize()
            with Session(monitor.engine) as db:
                query = select(MonitoringEvent).where(MonitoringEvent.camera_id == camera_id)
                if table_id:
                    query = query.where(MonitoringEvent.table_key == table_id)
                if before is not None:
                    query = query.where(MonitoringEvent.id < before)
                rows = db.exec(query.order_by(MonitoringEvent.id.desc()).limit(limit + 1)).all()
                page = rows[:limit]
                return {
                    "events": [
                        {
                            "id": row.id,
                            "kind": row.kind,
                            "table_id": row.table_key,
                            "session_id": row.session_id,
                            "at": timestamp(row.created_at),
                            "data": row.payload,
                            "actor": {
                                "id": row.actor_id,
                                "username": row.actor_username,
                                "display_name": row.actor_name,
                                "kind": row.actor_kind,
                            },
                        }
                        for row in page
                    ],
                    "next_before": page[-1].id if len(rows) > limit else None,
                }

    def correct(self, camera_id, table_id, action, actor=None):
        monitor = self.monitor
        with monitor.lock:
            monitor._initialize()
            with Session(monitor.engine) as db:
                revision, calibration = monitor.calibration.current(db)
                active = db.exec(
                    select(CaptureSession)
                    .where(CaptureSession.active_camera == camera_id)
                    .with_for_update()
                ).first()
                if not active or active.id not in monitor.machines:
                    raise MonitorError(409, "Start monitoring before making a cleaning correction.")
                layout = db.get(CameraLayout, active.layout_id)
                tables = monitor._tables(db, layout)
                table = next((item for item in tables if item["id"] == table_id), None)
                if table is None:
                    raise MonitorError(404, "Table not found in the current layout.")
                machine = copy.deepcopy(monitor.machines[active.id][table_id])
                if machine.calibration_revision != revision:
                    machine.recalibrate(calibration, revision)
                if machine.last_seen is None or monitor.clock() - machine.last_seen > 5:
                    machine.invalidate("Camera feed unavailable")
                previous_override = machine.manual_clean
                state = machine.correct(action)
                if previous_override != machine.manual_clean:
                    monitor._event(
                        db,
                        camera_id,
                        "manual_correction",
                        {"action": action},
                        table_id,
                        active.id,
                        actor,
                    )
                payload = monitor._write_state(
                    db, camera_id, table, state, active.id, machine.last_seen, emit=False
                )
                db.commit()
                monitor.machines[active.id][table_id] = machine
                return payload
