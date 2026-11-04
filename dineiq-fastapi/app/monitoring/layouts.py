import base64
import binascii
from typing import TYPE_CHECKING

from sqlmodel import Session, select

from app.detector import decode_jpeg
from app.models.monitoring import CameraLayout, CaptureSession, SeatRegion, TableRegion
from app.monitoring.contracts import LayoutInput
from app.monitoring.errors import MonitorError
from app.monitoring.registration import background_features
from app.monitoring.repositioning import setup_tracking
from app.monitoring.rules import TableMachine

if TYPE_CHECKING:
    from app.monitoring.service import MonitoringService


class LayoutService:
    def __init__(self, monitor: "MonitoringService"):
        self.monitor = monitor

    @staticmethod
    def _latest(db, camera_id, *, lock=False):
        query = (
            select(CameraLayout)
            .where(CameraLayout.camera_id == camera_id)
            .order_by(CameraLayout.revision.desc())
            .limit(1)
        )
        return db.exec(query.with_for_update() if lock else query).first()

    @staticmethod
    def _tables(db, layout):
        tables = []
        for table in db.exec(
            select(TableRegion).where(TableRegion.layout_id == layout.id).order_by(TableRegion.id)
        ).all():
            seats = db.exec(
                select(SeatRegion)
                .where(SeatRegion.table_region_id == table.id)
                .order_by(SeatRegion.id)
            ).all()
            tables.append(
                {
                    "id": table.table_key,
                    "name": table.name,
                    "polygon": table.polygon,
                    "seats": [{"id": seat.seat_key, "polygon": seat.polygon} for seat in seats],
                }
            )
        return tables

    def _layout_response(self, db, layout):
        monitor = self.monitor
        if layout is None:
            return None
        return {
            "camera_id": layout.camera_id,
            "revision": layout.revision,
            "position_version": layout.features.get("position_version", 0),
            "matching_status": layout.features.get("matching_status", "verifying"),
            "width": layout.width,
            "height": layout.height,
            "recalibration_required": layout.needs_reconfirmation,
            "tables": monitor._tables(db, layout),
        }

    def get_layout(self, camera_id="main"):
        monitor = self.monitor
        with monitor.lock:
            monitor._initialize()
            with Session(monitor.engine) as db:
                return monitor._layout_response(db, monitor._latest(db, camera_id))

    def suggest(self, content):
        monitor = self.monitor
        from app.monitoring.suggestions import suggest_layout

        decode_jpeg(content)
        return suggest_layout(monitor.detector.predict_monitoring(content))

    def save_layout(self, data: LayoutInput, actor=None):
        monitor = self.monitor
        try:
            content = base64.b64decode(data.frame, validate=True)
        except (ValueError, binascii.Error) as exc:
            raise MonitorError(422, "Calibration must contain a base64 JPEG frame.") from exc
        frame = decode_jpeg(content)
        height, width = frame.shape[:2]
        if (width, height) != (data.width, data.height):
            raise MonitorError(422, "Calibration dimensions must match the frozen camera frame.")
        tables = [table.model_dump(mode="json") for table in data.tables]
        features = setup_tracking(frame, tables, background_features(frame, tables))
        if len(features["descriptors"]) < 20:
            raise MonitorError(
                422,
                "Show more stationary background detail outside the table and "
                "seat regions, then capture setup again.",
            )
        with monitor.lock:
            monitor._initialize()
            with Session(monitor.engine) as db:
                previous = monitor._latest(db, data.camera_id, lock=True)
                revision = previous.revision if previous else 0
                if data.expected_revision != revision:
                    raise MonitorError(409, "Layout changed. Reload configuration before saving.")
                if previous and data.expected_position_version != previous.features.get(
                    "position_version", 0
                ):
                    raise MonitorError(
                        409, "Table positions changed. Reload configuration before saving."
                    )
                active = db.exec(
                    select(CaptureSession)
                    .where(CaptureSession.active_camera == data.camera_id)
                    .with_for_update()
                ).first()
                if active:
                    monitor._stop(db, active, "Layout changed", actor)
                record = CameraLayout(
                    camera_id=data.camera_id,
                    revision=revision + 1,
                    width=width,
                    height=height,
                    features=features,
                    created_at=monitor.clock(),
                )
                db.add(record)
                db.flush()
                for table in tables:
                    row = TableRegion(
                        layout_id=record.id,
                        table_key=table["id"],
                        name=table["name"],
                        polygon=table["polygon"],
                    )
                    db.add(row)
                    db.flush()
                    for seat in table["seats"]:
                        db.add(
                            SeatRegion(
                                table_region_id=row.id, seat_key=seat["id"], polygon=seat["polygon"]
                            )
                        )
                    state = TableMachine(len(table["seats"])).snapshot()
                    monitor._write_state(db, data.camera_id, table, state, None, None, emit=False)
                monitor._event(
                    db, data.camera_id, "layout_saved", {"revision": revision + 1}, actor=actor
                )
                db.commit()
                if active:
                    monitor.machines.pop(active.id, None)
                return monitor._layout_response(db, record)

    @staticmethod
    def write_positions(db, layout, tables):
        """Persist geometry inside the observation transaction without changing identities."""
        by_key = {table["id"]: table for table in tables}
        for row in db.exec(select(TableRegion).where(TableRegion.layout_id == layout.id)).all():
            table = by_key[row.table_key]
            row.polygon = table["polygon"]
            db.add(row)
            seats = {seat["id"]: seat for seat in table["seats"]}
            query = select(SeatRegion).where(SeatRegion.table_region_id == row.id)
            for seat in db.exec(query).all():
                seat.polygon = seats[seat.seat_key]["polygon"]
                db.add(seat)
