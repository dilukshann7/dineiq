import time
from threading import RLock
from uuid import uuid4

from sqlmodel import Session, select

from app.alerts.service import StaffAlerts
from app.auth.service import record_activity
from app.models.monitoring import CaptureSession, MonitoringEvent, TableSnapshot
from app.monitoring.actions import StaffActionService
from app.monitoring.capture import CaptureService
from app.monitoring.contracts import LayoutInput
from app.monitoring.errors import MonitorError as MonitorError
from app.monitoring.layouts import LayoutService
from app.monitoring.rules import TableMachine, observe_tables
from app.monitoring.states import TableStateService
from app.monitoring.time import timestamp as timestamp


class MonitoringService:
    def __init__(self, engine, detector):
        from app.calibration.preview import PreviewService
        from app.calibration.service import CalibrationService

        self.engine = engine
        self.detector = detector
        self.clock = time.time
        self.owner = uuid4().hex
        self.lock = RLock()
        self.initialized = False
        self.machines: dict[str, dict[str, TableMachine]] = {}
        self.in_flight: set[str] = set()
        self.alerts = StaffAlerts(self)
        self.layouts = LayoutService(self)
        self.capture = CaptureService(self)
        self.calibration = CalibrationService(engine, detector.settings, self)
        self.previews = PreviewService(self)
        self.table_states = TableStateService(self)
        self.staff_actions = StaffActionService(self)

    def database_failed(self):
        with self.lock:
            self.initialized = False
            for machines in self.machines.values():
                for machine in machines.values():
                    machine.invalidate("Database unavailable")

    def _event(self, db, camera_id, kind, payload=None, table_id=None, session_id=None, actor=None):
        db.add(
            MonitoringEvent(
                camera_id=camera_id,
                actor_id=actor.id if actor else None,
                actor_username=actor.username if actor else None,
                actor_name=actor.display_name if actor else None,
                actor_kind="user" if actor else "system",
                kind=kind,
                created_at=self.clock(),
                payload=payload or {},
                table_key=table_id,
                session_id=session_id,
            )
        )

        if actor:
            record_activity(
                db,
                actor,
                kind,
                camera_id=camera_id,
                table_id=table_id,
                visit_id=(payload or {}).get("visit_id"),
                alert_id=(payload or {}).get("alert_id"),
                data=payload,
            )

    def _initialize(self):
        if self.initialized:
            return
        with Session(self.engine) as db:
            sessions = db.exec(
                select(CaptureSession)
                .where(CaptureSession.active_camera.is_not(None))
                .with_for_update()
            ).all()
            for record in sessions:
                self.alerts.cancel_session(db, record.id)
                record.active_camera = None
                record.stopped_at = self.clock()
                record.token = ""
                db.add(record)
                self._unknown(db, record.camera_id, "Backend restarted; start monitoring again")
                self._event(db, record.camera_id, "backend_restart", session_id=record.id)
            for snapshot in db.exec(select(TableSnapshot)).all():
                snapshot.payload = {
                    **snapshot.payload,
                    "count": None,
                    "occupancy": "unknown",
                    "cleanliness": "unknown",
                    "valid": False,
                    "manual": False,
                    "reason": "Waiting for a new monitoring session",
                }
                db.add(snapshot)
            db.commit()
        self.machines.clear()
        self.capture.trackers.clear()
        self.in_flight.clear()
        self.initialized = True

    _latest = staticmethod(LayoutService._latest)
    _tables = staticmethod(LayoutService._tables)
    _credentials = staticmethod(CaptureService._credentials)

    def _layout_response(self, db, layout):
        return self.layouts._layout_response(db, layout)

    def get_layout(self, camera_id="main"):
        return self.layouts.get_layout(camera_id)

    def suggest(self, content):
        return self.layouts.suggest(content)

    def save_layout(self, data: LayoutInput, actor=None):
        return self.layouts.save_layout(data, actor)

    def _unknown(self, db, camera_id, reason):
        return self.table_states._unknown(db, camera_id, reason)

    def _write_state(
        self, db, camera_id, table, state, session_id, observed_at, *, emit=True, arrival_at=None
    ):
        return self.table_states._write_state(
            db, camera_id, table, state, session_id, observed_at, emit=emit, arrival_at=arrival_at
        )

    def _stop(self, db, record, reason, actor=None):
        return self.capture._stop(db, record, reason, actor)

    def start(self, camera_id="main", expected_revision=None, actor=None):
        return self.capture.start(camera_id, expected_revision, actor)

    def stop(self, session_id, actor=None):
        return self.capture.stop(session_id, actor)

    def process(self, session_id, sequence, token, content):
        return self.capture.process(session_id, sequence, token, content, observe_tables)

    def invalidate_session(self, session_id, reason):
        return self.capture.invalidate_session(session_id, reason)

    def watchdog(self):
        return self.capture.watchdog()

    def states(self, camera_id="main"):
        return self.table_states.states(camera_id)

    def history(self, camera_id="main", table_id=None, before=None, limit=20):
        return self.table_states.history(camera_id, table_id, before, limit)

    def correct(self, camera_id, table_id, action, actor=None):
        return self.table_states.correct(camera_id, table_id, action, actor)

    def mark_served(self, camera_id, table_id, visit_id, actor=None):
        return self.staff_actions.mark_served(camera_id, table_id, visit_id, actor)

    def acknowledge_alert(self, camera_id, alert_id, actor=None):
        return self.staff_actions.acknowledge_alert(camera_id, alert_id, actor)
