from sqlalchemy import CheckConstraint
from sqlmodel import Field, SQLModel


class InstallationState(SQLModel, table=True):
    __tablename__ = "installation_state"
    __table_args__ = (CheckConstraint("id = 1", name="ck_installation_singleton"),)
    id: int = Field(default=1, primary_key=True)
    generation: int = 1
    checkpoint: str = "camera"
    completed_at: float | None = None
    code_hash: str | None = None
    code_expires_at: float | None = None
    grant_hash: str | None = None
    grant_expires_at: float | None = None
