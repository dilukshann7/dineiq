"""Ephemeral simulations. This module intentionally has no production write path."""

import copy
import secrets
import time
from dataclasses import dataclass, field
from threading import RLock

from fastapi import HTTPException
from sqlmodel import Session

from app.calibration.contracts import Calibration
from app.detector import decode_jpeg
from app.monitoring.registration import background_features, registration_status
from app.monitoring.repositioning import PositionTracker
from app.monitoring.rules import TableMachine, observe_tables
from app.monitoring.time import OBSERVATION_TIMEOUT_SECONDS


class PreviewBusy(Exception):
    """Production inference has priority; caller should skip this preview frame."""


@dataclass
class Simulation:
    settings: Calibration
    tables: list
    features: dict
    machines: dict = field(default_factory=dict)
    tracker: PositionTracker = field(default_factory=PositionTracker)

    def evaluate(self, frame, detections, now, late=False):
        detections = self.settings.filter(detections)
        if not self.tables:
            return {"detections": detections, "tables": [], "matching_status": "no_layout"}
        background = registration_status(
            self.features, background_features(frame, self.tables), self.settings
        )
        if (
            abs(frame.shape[1] / frame.shape[0] - self.features["width"] / self.features["height"])
            > 0.01
        ):
            background = "moved"
        adjustment = self.tracker.evaluate(
            frame,
            self.tables,
            self.features,
            detections,
            background,
            now,
            force_verify=True,
            calibration=self.settings,
        )
        self.tables, self.features = adjustment["tables"], adjustment["features"]
        observations = observe_tables(self.tables, detections, self.settings, diagnostics=True)
        states = []
        for table in self.tables:
            machine = self.machines.setdefault(
                table["id"], TableMachine(len(table["seats"]), self.settings)
            )
            if (
                late
                or table["id"] not in adjustment["verified"]
                or table["id"] in adjustment["changed"]
            ):
                state = machine.invalidate(
                    "Processing too slow" if late else "Verifying table and seat positions"
                )
            else:
                state = machine.observe(observations[table["id"]], now)
            states.append(
                {
                    **state,
                    "id": table["id"],
                    "name": table["name"],
                    "countdowns": machine.countdowns(now),
                    "diagnostics": observations[table["id"]]["diagnostics"],
                }
            )
        return {
            "detections": detections,
            "tables": states,
            "layout": self.tables,
            "matching_status": adjustment["status"],
        }


@dataclass
class Preview:
    owner: str
    camera_id: str
    revision: int
    layout_identity: tuple | None
    active: Simulation
    draft: Simulation
    last_seen: float
    last_frame: float = float("-inf")
    sequence: int = 0
    busy: bool = False


class PreviewService:
    def __init__(self, monitor):
        self.monitor = monitor
        self.lock = RLock()
        self.sessions = {}
        self.clock = time.monotonic

    def clear(self):
        with self.lock:
            self.sessions.clear()

    def expire(self):
        with self.lock:
            now = self.clock()
            for key, session in list(self.sessions.items()):
                if not session.busy and now - session.last_seen >= 60:
                    self.sessions.pop(key, None)

    @staticmethod
    def identity(layout):
        return (
            (layout.id, layout.revision, layout.features.get("position_version", 0))
            if layout
            else None
        )

    def start(self, data, actor):
        self.expire()
        with Session(self.monitor.engine) as db:
            revision, active = self.monitor.calibration.current(db)
            layout = self.monitor._latest(db, data.camera_id)
            if data.expected_layout_revision != (layout.revision if layout else None):
                raise HTTPException(409, "Table setup changed. Reload before previewing.")
            tables = self.monitor._tables(db, layout) if layout else []
            features = copy.deepcopy(layout.features) if layout else {}
            identity = self.identity(layout)
            db.commit()
        session = Preview(
            str(actor.id),
            data.camera_id,
            revision,
            identity,
            Simulation(active, copy.deepcopy(tables), copy.deepcopy(features)),
            Simulation(data.settings, copy.deepcopy(tables), copy.deepcopy(features)),
            self.clock(),
        )
        with self.lock:
            for key, old in list(self.sessions.items()):
                if old.owner == session.owner:
                    self.sessions.pop(key)
            key = secrets.token_urlsafe(24)
            self.sessions[key] = session
        return {"id": key, "revision": revision, "has_layout": bool(tables)}

    def owned(self, key, actor):
        self.expire()
        session = self.sessions.get(key)
        if session is None or session.owner != str(actor.id):
            raise HTTPException(404, "Preview expired or unavailable. Start preview again.")
        return session

    def stop(self, key, actor):
        with self.lock:
            self.owned(key, actor)
            self.sessions.pop(key, None)
        return {"status": "stopped"}

    def check_current(self, session):
        with Session(self.monitor.engine) as db:
            revision, _ = self.monitor.calibration.current(db)
            layout = self.monitor._latest(db, session.camera_id)
            valid = (
                revision == session.revision and self.identity(layout) == session.layout_identity
            )
            db.commit()
        if not valid:
            raise HTTPException(409, "Calibration or table setup changed. Restart preview.")

    def process(self, key, actor, sequence, content):
        with self.lock:
            session = self.owned(key, actor)
            now = self.clock()
            if sequence <= session.sequence:
                raise HTTPException(409, "Preview frame sequence must increase.")
            if session.busy or now - session.last_frame < 1:
                raise HTTPException(
                    429, "Preview is busy. Retry later.", headers={"Retry-After": "1"}
                )
            session.busy = True
            session.sequence, session.last_seen, session.last_frame = sequence, now, now
        try:
            self.check_current(session)
            # Both simulations use the same model output, preserving one inference per frame.
            values = session.active.settings.model_dump()
            for name in (
                "person_confidence",
                "table_confidence",
                "chair_confidence",
                "object_confidence",
            ):
                values[name] = min(values[name], getattr(session.draft.settings, name))
            result = self.monitor.detector.predict_preview(content, Calibration(**values))
            frame = decode_jpeg(content)
            late = self.clock() - now > OBSERVATION_TIMEOUT_SECONDS
            active, draft = copy.deepcopy(session.active), copy.deepcopy(session.draft)
            output = {
                "active": active.evaluate(frame, result["detections"], now, late),
                "draft": draft.evaluate(frame, result["detections"], now, late),
                "width": result["width"],
                "height": result["height"],
                "revision": session.revision,
                "sequence": sequence,
            }
            self.check_current(session)
            with self.lock:
                if self.sessions.get(key) is not session:
                    raise HTTPException(409, "Preview ended. Start preview again.")
                session.active, session.draft = active, draft
            return output
        except PreviewBusy as exc:
            raise HTTPException(
                429,
                "Production inference is busy; preview frame skipped.",
                headers={"Retry-After": "1"},
            ) from exc
        except HTTPException as exc:
            if exc.status_code == 409:
                with self.lock:
                    self.sessions.pop(key, None)
            raise
        finally:
            with self.lock:
                session.busy = False
