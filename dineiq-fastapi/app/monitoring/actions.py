from typing import TYPE_CHECKING

from sqlmodel import Session, select

from app.models.monitoring import CaptureSession, StaffAlert, TableSnapshot
from app.monitoring.errors import MonitorError
from app.monitoring.time import timestamp

if TYPE_CHECKING:
    from app.monitoring.service import MonitoringService


class StaffActionService:
    def __init__(self, monitor: "MonitoringService"):
        self.monitor = monitor

    def mark_served(self, camera_id, table_id, visit_id, actor=None):
        monitor = self.monitor
        with monitor.lock:
            monitor._initialize()
            with Session(monitor.engine) as db:
                capture = db.exec(
                    select(CaptureSession)
                    .where(CaptureSession.active_camera == camera_id)
                    .with_for_update()
                ).first()
                visit = monitor.alerts.visit(db, capture.id, table_id) if capture else None
                if not visit or visit.id != visit_id:
                    raise MonitorError(
                        409, "Visit changed. Reload the table before marking served."
                    )
                snapshot = db.get(TableSnapshot, (camera_id, table_id))
                if visit.served_at is None:
                    if (
                        monitor.clock() - capture.updated_at > 5
                        or not snapshot.payload["valid"]
                        or not snapshot.payload["count"]
                        or snapshot.payload.get("reason")
                        or not monitor.alerts.fresh(snapshot.payload)
                    ):
                        raise MonitorError(
                            409,
                            "Wait for a current occupied observation before confirming service.",
                        )
                    visit.served_at = monitor.clock()
                    db.add(visit)
                    monitor._event(
                        db,
                        camera_id,
                        "service_confirmed",
                        {"visit_id": visit.id},
                        table_id,
                        capture.id,
                        actor,
                    )
                    for alert in monitor.alerts.current(db, capture.id, table_id):
                        if alert.kind == "service":
                            monitor.alerts.finish(db, alert)
                snapshot.payload = {**snapshot.payload, "updated_at": timestamp(monitor.clock())}
                db.add(snapshot)
                db.commit()
                return monitor.alerts.enrich(db, snapshot.payload, capture.id)

    def acknowledge_alert(self, camera_id, alert_id, actor=None):
        monitor = self.monitor
        with monitor.lock:
            monitor._initialize()
            with Session(monitor.engine) as db:
                alert = db.get(StaffAlert, alert_id)
                if (
                    not alert
                    or alert.camera_id != camera_id
                    or alert.kind != "cleaning"
                    or alert.resolved_at is not None
                    or not monitor.alerts.eligible(db, alert)
                ):
                    raise MonitorError(
                        409, "Cleaning alert changed. Reload the table before acknowledging."
                    )
                if alert.acknowledged_at is None:
                    alert.acknowledged_at = monitor.clock()
                    db.add(alert)
                    monitor.alerts.event(db, alert, "alert_acknowledged", actor)
                snapshot = db.get(TableSnapshot, (camera_id, alert.table_key))
                snapshot.payload = {**snapshot.payload, "updated_at": timestamp(monitor.clock())}
                db.add(snapshot)
                db.commit()
                return monitor.alerts.enrich(db, snapshot.payload, alert.session_id)
