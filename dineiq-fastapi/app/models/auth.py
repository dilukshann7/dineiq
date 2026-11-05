from uuid import uuid4

from sqlalchemy import JSON, CheckConstraint, Column
from sqlmodel import Field, SQLModel


class Account(SQLModel, table=True):
    __tablename__ = "account"
    __table_args__ = (CheckConstraint("role IN ('ADMIN', 'STAFF')", name="ck_account_role"),)
    id: str = Field(default_factory=lambda: uuid4().hex, primary_key=True)
    username: str = Field(unique=True, index=True)
    display_name: str
    password_hash: str
    role: str
    active: bool = True
    must_change_password: bool = False
    created_at: float


class BrowserSession(SQLModel, table=True):
    __tablename__ = "browser_session"
    token_hash: str = Field(primary_key=True)
    account_id: str = Field(foreign_key="account.id", index=True)
    csrf_token: str
    created_at: float
    expires_at: float = Field(index=True)
    revoked: bool = False


class LoginFailure(SQLModel, table=True):
    __tablename__ = "login_failure"
    id: int | None = Field(default=None, primary_key=True)
    username: str = Field(index=True)
    ip: str = Field(index=True)
    created_at: float = Field(index=True)


class Activity(SQLModel, table=True):
    __tablename__ = "activity"
    id: int | None = Field(default=None, primary_key=True)
    actor_id: str = Field(foreign_key="account.id", index=True)
    actor_username: str
    actor_name: str
    target_user_id: str | None = Field(default=None, foreign_key="account.id", index=True)
    action: str = Field(index=True)
    created_at: float = Field(index=True)
    camera_id: str | None = None
    table_id: str | None = Field(default=None, index=True)
    visit_id: str | None = None
    alert_id: str | None = None
    data: dict = Field(default_factory=dict, sa_column=Column(JSON, nullable=False))
