from sqlalchemy import JSON, CheckConstraint, Column
from sqlmodel import Field, SQLModel


class CalibrationRevision(SQLModel, table=True):
    __tablename__ = "calibration_revision"
    id: int | None = Field(default=None, primary_key=True)
    settings: dict = Field(sa_column=Column(JSON, nullable=False))
    actor_id: str | None = Field(default=None, foreign_key="account.id")
    actor_username: str | None = None
    created_at: float


class ActiveCalibration(SQLModel, table=True):
    __tablename__ = "active_calibration"
    __table_args__ = (CheckConstraint("id = 1", name="ck_calibration_singleton"),)
    id: int = Field(default=1, primary_key=True)
    revision_id: int | None = Field(default=None, foreign_key="calibration_revision.id")
