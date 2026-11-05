"""Durable staff episodes, updated in the same transaction as observations."""

from datetime import datetime

from sqlmodel import Session, select

from app.models.monitoring import CaptureSession, StaffAlert, TableSnapshot, TableVisit, new_id
from app.monitoring.time import timestamp


def stamp(value):
    return timestamp(value)


class StaffAlerts:
    def __init__(self, monitor):
        self.monitor = monitor

    def fresh(self, state):
        observed = state.get("observed_at")
        return bool(
            observed and self.monitor.clock() - datetime.fromisoformat(observed).timestamp() <= 5
        )

    def event(self, db, alert, kind, actor=None):
        self.monitor._event(
            db,
            alert.camera_id,
            kind,
            {
                "alert_id": alert.id,
                "kind": alert.kind,
                "delivery_status": alert.delivery_status,
                "error": alert.last_error,
            },
            alert.table_key,
            alert.session_id,
            actor,
        )

    @staticmethod
    def visit(db, session_id, table_id):
        return db.exec(
            select(TableVisit).where(TableVisit.active_key == f"{session_id}:{table_id}")
        ).first()

    @staticmethod
    def current(db, session_id, table_id):
        return db.exec(
            select(StaffAlert)
            .where(
                StaffAlert.session_id == session_id,
                StaffAlert.table_key == table_id,
                StaffAlert.resolved_at.is_(None),
            )
            .order_by(StaffAlert.created_at, StaffAlert.id)
        ).all()

    def finish(self, db, alert, *, cancelled=False):
        alert.resolved_at = self.monitor.clock()
        alert.active_key = None
        if alert.delivery_status in ("pending", "sending"):
            alert.delivery_status = "cancelled"
        db.add(alert)
        self.event(db, alert, "alert_cancelled" if cancelled else "alert_resolved")

    def cancel_session(self, db, session_id):
        for alert in db.exec(
            select(StaffAlert).where(
                StaffAlert.session_id == session_id, StaffAlert.resolved_at.is_(None)
            )
        ).all():
            self.finish(db, alert, cancelled=True)
        for visit in db.exec(
            select(TableVisit).where(
                TableVisit.session_id == session_id, TableVisit.ended_at.is_(None)
            )
        ).all():
            visit.active_key = None
            visit.ended_at = self.monitor.clock()
            db.add(visit)

    def cancel_table(self, db, session_id, table_id):
        """End staff episodes for a removed table without affecting surviving tables."""
        for alert in self.current(db, session_id, table_id):
            self.finish(db, alert, cancelled=True)
        visit = self.visit(db, session_id, table_id)
        if visit:
            visit.active_key = None
            visit.ended_at = self.monitor.clock()
            db.add(visit)

    def create(self, db, session_id, table, kind, *, visit=None, evidence=None):
        episode = f"service:{visit.id}" if visit else f"cleaning:{new_id()}"
        # A resolved service alert cannot be recreated for the same visit.
        if db.exec(select(StaffAlert).where(StaffAlert.episode_key == episode)).first():
            return
        alert = StaffAlert(
            episode_key=episode,
            active_key=f"{session_id}:{table['id']}:{kind}",
            camera_id=table["camera_id"],
            table_key=table["id"],
            table_name=table["name"],
            session_id=session_id,
            visit_id=visit.id if visit else None,
            kind=kind,
            created_at=self.monitor.clock(),
            next_retry_at=self.monitor.clock(),
            details={"arrived_at": visit.arrived_at} if visit else {"items": evidence or []},
        )
        db.add(alert)
        db.flush()
        self.event(db, alert, "alert_created")

    def synchronize(self, db, camera_id, table, state, session_id, arrival_at=None):
        if not session_id or not state["valid"] or state.get("reason"):
            return
        table = {**table, "camera_id": camera_id}
        visit = self.visit(db, session_id, table["id"])
        active = self.current(db, session_id, table["id"])
        if state["count"] > 0:
            for alert in active:
                if alert.kind == "cleaning":
                    self.finish(db, alert)
            if visit is None:
                visit = TableVisit(
                    active_key=f"{session_id}:{table['id']}",
                    camera_id=camera_id,
                    table_key=table["id"],
                    session_id=session_id,
                    arrived_at=arrival_at if arrival_at is not None else self.monitor.clock(),
                )
                db.add(visit)
                db.flush()
                self.monitor._event(
                    db,
                    camera_id,
                    "visit_started",
                    {"visit_id": visit.id, "arrived_at": stamp(visit.arrived_at)},
                    table["id"],
                    session_id,
                )
            if visit.served_at is None and self.monitor.clock() - visit.arrived_at >= 300:
                self.create(db, session_id, table, "service", visit=visit)
        else:
            if visit:
                visit.active_key = None
                visit.ended_at = self.monitor.clock()
                db.add(visit)
                self.monitor._event(
                    db, camera_id, "visit_ended", {"visit_id": visit.id}, table["id"], session_id
                )
            for alert in active:
                if alert.kind == "service" or state["cleanliness"] == "looks_clear":
                    self.finish(db, alert)
            if state["cleanliness"] == "needs_cleaning" and not any(
                a.kind == "cleaning" and a.resolved_at is None for a in active
            ):
                self.create(db, session_id, table, "cleaning", evidence=state["evidence"])

    def enrich(self, db, payload, session_id):
        visit = self.visit(db, session_id, payload["id"]) if session_id else None
        alerts = self.current(db, session_id, payload["id"]) if session_id else []
        return {
            **payload,
            "visit_id": visit.id if visit else None,
            "arrived_at": stamp(visit.arrived_at) if visit else None,
            "served_at": stamp(visit.served_at) if visit else None,
            "service_status": (
                "served"
                if visit.served_at is not None
                else "overdue"
                if self.monitor.clock() - visit.arrived_at >= 300
                else "waiting"
            )
            if visit
            else "none",
            "alerts": [
                {
                    "id": a.id,
                    "kind": a.kind,
                    "created_at": stamp(a.created_at),
                    "acknowledged_at": stamp(a.acknowledged_at),
                    "delivery_status": a.delivery_status,
                    "last_error": a.last_error,
                }
                for a in alerts
            ],
        }

    def eligible(self, db, alert):
        capture = db.get(CaptureSession, alert.session_id)
        snapshot = db.get(TableSnapshot, (alert.camera_id, alert.table_key))
        if (
            not capture
            or capture.stopped_at is not None
            or capture.owner != self.monitor.owner
            or self.monitor.clock() - capture.updated_at > 5
            or not snapshot
        ):
            return False
        state = snapshot.payload
        if not state["valid"] or state.get("reason") or not self.fresh(state):
            return False
        if alert.kind == "cleaning":
            return state["count"] == 0 and state["cleanliness"] == "needs_cleaning"
        visit = db.get(TableVisit, alert.visit_id)
        return bool(visit and visit.ended_at is None and visit.served_at is None and state["count"])

    def evaluate(self):
        # Do not initialize the database from a background task: /health and /detect
        # must remain usable before the monitoring migration has been applied.
        if not self.monitor.initialized:
            return
        with self.monitor.lock, Session(self.monitor.engine) as db:
            for capture in db.exec(
                select(CaptureSession).where(
                    CaptureSession.active_camera.is_not(None),
                    CaptureSession.owner == self.monitor.owner,
                )
            ).all():
                if self.monitor.clock() - capture.updated_at > 5:
                    continue
                for row in db.exec(
                    select(TableSnapshot).where(TableSnapshot.camera_id == capture.camera_id)
                ).all():
                    if self.fresh(row.payload):
                        self.synchronize(
                            db, capture.camera_id, row.payload, row.payload, capture.id
                        )
            db.commit()
