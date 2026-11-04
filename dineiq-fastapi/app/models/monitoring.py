from uuid import uuid4

from sqlalchemy import JSON, Column, UniqueConstraint
from sqlmodel import Field, SQLModel


def new_id() -> str:
    return uuid4().hex


class CameraLayout(SQLModel, table=True):
    __tablename__ = "camera_layout"
    __table_args__ = (UniqueConstraint("camera_id", "revision"),)
    id: str = Field(default_factory=new_id, primary_key=True)
    camera_id: str = Field(index=True)
    revision: int
    width: int
    height: int
    features: dict = Field(sa_column=Column(JSON, nullable=False))
    needs_reconfirmation: bool = False
    created_at: float


class TableRegion(SQLModel, table=True):
    __tablename__ = "table_region"
    __table_args__ = (UniqueConstraint("layout_id", "table_key"),)
    id: str = Field(default_factory=new_id, primary_key=True)
    layout_id: str = Field(foreign_key="camera_layout.id", index=True)
    table_key: str
    name: str
    polygon: list = Field(sa_column=Column(JSON, nullable=False))


class SeatRegion(SQLModel, table=True):
    __tablename__ = "seat_region"
    __table_args__ = (UniqueConstraint("table_region_id", "seat_key"),)
    id: str = Field(default_factory=new_id, primary_key=True)
    table_region_id: str = Field(foreign_key="table_region.id", index=True)
    seat_key: str
    polygon: list = Field(sa_column=Column(JSON, nullable=False))


class CaptureSession(SQLModel, table=True):
    __tablename__ = "capture_session"
    id: str = Field(default_factory=new_id, primary_key=True)
    camera_id: str = Field(index=True)
    # NULL after stopping: portable uniqueness permits history but only one active camera.
    active_camera: str | None = Field(default=None, unique=True)
    layout_id: str = Field(foreign_key="camera_layout.id")
    owner: str
    token: str
    token_expires: float
    sequence: int = 0
    created_at: float
    updated_at: float
    stopped_at: float | None = None
    interrupted: bool = False
    last_valid_frame_at: float | None = None


class TableSnapshot(SQLModel, table=True):
    __tablename__ = "table_snapshot"
    camera_id: str = Field(primary_key=True)
    table_key: str = Field(primary_key=True)
    payload: dict = Field(sa_column=Column(JSON, nullable=False))


class MonitoringEvent(SQLModel, table=True):
    __tablename__ = "monitoring_event"
    id: int | None = Field(default=None, primary_key=True)
    camera_id: str = Field(index=True)
    table_key: str | None = Field(default=None, index=True)
    session_id: str | None = Field(default=None, index=True)
    actor_id: str | None = Field(default=None, foreign_key="account.id", index=True)
    actor_username: str | None = None
    actor_name: str | None = None
    actor_kind: str = "system"
    kind: str
    created_at: float = Field(index=True)
    payload: dict = Field(default_factory=dict, sa_column=Column(JSON, nullable=False))


class TableVisit(SQLModel, table=True):
    __tablename__ = "table_visit"
    id: str = Field(default_factory=new_id, primary_key=True)
    active_key: str | None = Field(default=None, unique=True)
    camera_id: str = Field(index=True)
    table_key: str
    session_id: str = Field(foreign_key="capture_session.id", index=True)
    arrived_at: float
    served_at: float | None = None
    ended_at: float | None = None


class StaffAlert(SQLModel, table=True):
    __tablename__ = "staff_alert"
    id: str = Field(default_factory=new_id, primary_key=True)
    episode_key: str = Field(unique=True)
    active_key: str | None = Field(default=None, unique=True)
    camera_id: str = Field(index=True)
    table_key: str
    table_name: str
    session_id: str = Field(foreign_key="capture_session.id", index=True)
    visit_id: str | None = Field(default=None, foreign_key="table_visit.id")
    kind: str
    created_at: float
    acknowledged_at: float | None = None
    resolved_at: float | None = None
    delivery_status: str = "pending"
    attempts: int = 0
    next_retry_at: float
    telegram_message_id: int | None = None
    last_error: str | None = None
    details: dict = Field(default_factory=dict, sa_column=Column(JSON, nullable=False))
