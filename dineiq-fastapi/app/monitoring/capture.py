import copy
import secrets
from typing import TYPE_CHECKING

from sqlalchemy.exc import SQLAlchemyError
from sqlmodel import Session, select

from app.detector import decode_jpeg
from app.models.monitoring import CameraLayout, CaptureSession
from app.monitoring.errors import MonitorError
from app.monitoring.registration import background_features, registration_status
from app.monitoring.repositioning import PositionTracker
from app.monitoring.rules import TableMachine
from app.monitoring.time import timestamp

if TYPE_CHECKING:
    from app.monitoring.service import MonitoringService


class CaptureService:
    def __init__(self, monitor: "MonitoringService"):
        self.monitor = monitor
        self.trackers: dict[str, PositionTracker] = {}

    def _stop(self, db, record, reason, actor=None):
        monitor = self.monitor
        if record.stopped_at is not None:
            return
        monitor.alerts.cancel_session(db, record.id)
        self.trackers.pop(record.id, None)
        record.stopped_at = monitor.clock()
        record.active_camera = None
        record.token = ""
        db.add(record)
        monitor._unknown(db, record.camera_id, reason)
        monitor._event(
            db,
            record.camera_id,
            "session_stopped",
            {"reason": reason},
            session_id=record.id,
            actor=actor,
        )

    def start(self, camera_id="main", expected_revision=None, actor=None):
        monitor = self.monitor
        with monitor.lock:
            monitor._initialize()
            with Session(monitor.engine) as db:
                layout = monitor._latest(db, camera_id, lock=True)
                if layout is None:
                    raise MonitorError(409, "Configure tables before starting monitoring.")
                if expected_revision is not None and expected_revision != layout.revision:
                    raise MonitorError(
                        409, "Layout changed. Reload table configuration before monitoring."
                    )
                active = db.exec(
                    select(CaptureSession)
                    .where(CaptureSession.active_camera == camera_id)
                    .with_for_update()
                ).first()
                if active:
                    if monitor.clock() - active.updated_at <= 5:
                        raise MonitorError(
                            409, "This camera already has an active capture session."
                        )
                    monitor._stop(db, active, "Previous capture timed out")
                    db.flush()
                tables = monitor._tables(db, layout)
                record = CaptureSession(
                    camera_id=camera_id,
                    active_camera=camera_id,
                    layout_id=layout.id,
                    owner=monitor.owner,
                    token=secrets.token_urlsafe(32),
                    token_expires=monitor.clock() + 5,
                    created_at=monitor.clock(),
                    updated_at=monitor.clock(),
                )
                db.add(record)
                monitor._unknown(db, camera_id, "Confirming new observations")
                for table in tables:
                    monitor._write_state(
                        db,
                        camera_id,
                        table,
                        TableMachine(len(table["seats"])).snapshot(),
                        record.id,
                        None,
                        emit=False,
                    )
                monitor._event(db, camera_id, "session_started", session_id=record.id, actor=actor)
                db.commit()
                monitor.machines[record.id] = {
                    table["id"]: TableMachine(len(table["seats"])) for table in tables
                }
                self.trackers[record.id] = PositionTracker()
                return monitor._credentials(record)

    @staticmethod
    def _credentials(record):
        return {
            "session_id": record.id,
            "token": record.token,
            "sequence": record.sequence,
            "expires_at": timestamp(record.token_expires),
        }

    def stop(self, session_id, actor=None):
        monitor = self.monitor
        with monitor.lock:
            monitor._initialize()
            with Session(monitor.engine) as db:
                record = db.get(CaptureSession, session_id)
                if record:
                    monitor._stop(db, record, "Camera stopped", actor)
                    db.commit()
                monitor.machines.pop(session_id, None)
                return {"status": "stopped"}

    def process(self, session_id, sequence, token, content, observe):
        monitor = self.monitor
        received = monitor.clock()
        with monitor.lock:
            monitor._initialize()
            with Session(monitor.engine) as db:
                record = db.exec(
                    select(CaptureSession).where(CaptureSession.id == session_id).with_for_update()
                ).first()
                if record is None or record.stopped_at is not None or record.owner != monitor.owner:
                    raise MonitorError(409, "Capture session ended. Start monitoring again.")
                if (
                    sequence <= record.sequence
                    or not record.token
                    or not secrets.compare_digest(token, record.token)
                    or received > record.token_expires
                    or session_id in monitor.in_flight
                ):
                    raise MonitorError(
                        409, "Frame expired or was already submitted. Restart monitoring."
                    )
                layout = db.get(CameraLayout, record.layout_id)
                tables = monitor._tables(db, layout)
                reference = copy.deepcopy(layout.features)
                force_verify = layout.needs_reconfirmation
                tracker = copy.deepcopy(self.trackers.get(session_id, PositionTracker()))
                expected_aspect = layout.width / layout.height
                record.sequence = sequence
                record.token = ""
                record.updated_at = received
                db.add(record)
                db.commit()
            monitor.in_flight.add(session_id)
        try:
            frame = decode_jpeg(content)
            height, width = frame.shape[:2]
            result = monitor.detector.predict_monitoring(content)
            background = registration_status(reference, background_features(frame, tables))
            if abs(width / height - expected_aspect) > .01:
                background = "moved"
            late = monitor.clock() - received > 2
            adjustment = tracker.evaluate(
                frame, tables, reference, [] if late else result["detections"],
                "uncertain" if late else background, received, force_verify=force_verify,
            )
            tables = adjustment["tables"]
            observations = observe(tables, result["detections"])
            with monitor.lock:
                with Session(monitor.engine) as db:
                    record = db.exec(
                        select(CaptureSession)
                        .where(CaptureSession.id == session_id)
                        .with_for_update()
                    ).first()
                    if (
                        record is None or record.stopped_at is not None
                        or session_id not in monitor.machines
                    ):
                        raise MonitorError(409, "Capture session ended during processing.")
                    machines = copy.deepcopy(monitor.machines[session_id])
                    late = monitor.clock() - received > 2
                    layout = db.get(CameraLayout, record.layout_id)
                    if late:
                        # Slow evidence cannot commit or advance geometry verification.
                        adjustment.update(tables=monitor._tables(db, layout),
                                          features=reference, changed=set(), verified=set(),
                                          trusted=set(), blocked=False, status="verifying")
                        tables = adjustment["tables"]
                        tracker = PositionTracker()
                    layout.needs_reconfirmation = adjustment["blocked"] or (
                        layout.needs_reconfirmation and len(adjustment["trusted"]) != len(tables)
                    )
                    layout.features = {**adjustment["features"],
                                       "matching_status": adjustment["status"]}
                    db.add(layout)
                    if adjustment["changed"]:
                        monitor.layouts.write_positions(db, layout, tables)
                        monitor._event(db, record.camera_id, "layout_adjusted", {
                            "position_version": layout.features["position_version"],
                            "table_ids": sorted(adjustment["changed"]),
                        }, session_id=session_id)
                    states = []
                    for table in tables:
                        machine = machines[table["id"]]
                        if late:
                            state = machine.invalidate(
                                "Processing too slow for continuous evidence"
                            )
                        elif table["id"] not in adjustment["verified"]:
                            state = machine.invalidate(
                                "Verifying table and seat positions" if not adjustment["blocked"]
                                else "Layout mismatch; check table setup"
                            )
                        else:
                            if table["id"] in adjustment["changed"]:
                                machine.invalidate(
                                    "Table positions adjusted; confirming observations"
                                )
                            state = machine.observe(observations[table["id"]], received)
                        states.append(
                            monitor._write_state(
                                db,
                                record.camera_id,
                                table,
                                state,
                                session_id,
                                machine.last_seen,
                                arrival_at=machine.arrival_at,
                            )
                        )
                    record.token = secrets.token_urlsafe(32)
                    record.token_expires = monitor.clock() + 5
                    record.interrupted = False
                    verification_passed = bool(
                        adjustment["verified"] and not late and not layout.needs_reconfirmation
                    )
                    record.last_valid_frame_at = received if verification_passed else None
                    db.add(record)
                    db.flush()
                    current_layout = monitor._layout_response(db, layout)
                    db.commit()
                    monitor.machines[session_id] = machines
                    self.trackers[session_id] = tracker
                    return {
                        **result,
                        **monitor._credentials(record),
                        "tables": states,
                        "recalibration_required": layout.needs_reconfirmation,
                        "matching_status": adjustment["status"],
                        "verification_passed": verification_passed,
                        "layout": current_layout,
                    }
        except Exception:
            monitor.invalidate_session(session_id, "Invalid or interrupted observation")
            raise
        finally:
            with monitor.lock:
                monitor.in_flight.discard(session_id)

    def invalidate_session(self, session_id, reason):
        monitor = self.monitor
        with monitor.lock:
            self.trackers.pop(session_id, None)
            for machine in monitor.machines.get(session_id, {}).values():
                machine.invalidate(reason)
            try:
                with Session(monitor.engine) as db:
                    record = db.get(CaptureSession, session_id)
                    if record and record.stopped_at is None and record.owner == monitor.owner:
                        record.last_valid_frame_at = None
                        db.add(record)
                        monitor._unknown(db, record.camera_id, reason)
                        db.commit()
            except SQLAlchemyError:
                monitor.database_failed()

    def watchdog(self):
        monitor = self.monitor
        if not monitor.initialized:
            return
        try:
            with monitor.lock, Session(monitor.engine) as db:
                records = db.exec(
                    select(CaptureSession)
                    .where(
                        CaptureSession.active_camera.is_not(None),
                        CaptureSession.updated_at < monitor.clock() - 5,
                        CaptureSession.interrupted == False,  # noqa: E712
                    )
                    .with_for_update()
                ).all()
                for record in records:
                    for machine in monitor.machines.get(record.id, {}).values():
                        machine.invalidate("Camera feed unavailable")
                    monitor._unknown(db, record.camera_id, "Camera feed unavailable")
                    monitor._event(db, record.camera_id, "feed_interrupted", session_id=record.id)
                    record.interrupted = True
                    db.add(record)
                db.commit()
        except SQLAlchemyError:
            monitor.database_failed()
