from sqlalchemy import CheckConstraint
from sqlmodel import Field, SQLModel


class TelegramConfiguration(SQLModel, table=True):
    __tablename__ = "telegram_configuration"
    __table_args__ = (CheckConstraint("id = 1", name="ck_telegram_singleton"),)

    id: int = Field(default=1, primary_key=True)
    enabled: bool = False
    bot_token: str = Field(default="", repr=False)
    chat_id: str = ""
