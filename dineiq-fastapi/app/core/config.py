import re
from functools import lru_cache
from pathlib import Path

from pydantic import Field, PostgresDsn, SecretStr, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=BACKEND_DIR / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
        hide_input_in_errors=True,
    )

    auth_secure_cookie: bool = False

    app_name: str = "DineIQ API"
    database_url: PostgresDsn = PostgresDsn(
        "postgresql+psycopg://dineiq:change-me@localhost:5432/dineiq"
    )
    cors_origins: list[str] = ["http://localhost:5173", "http://127.0.0.1:5173"]
    yolo_model_path: Path = BACKEND_DIR.parent.parent / "downloads" / "models" / "yolo26m-seg.pt"
    yolo_confidence: float = Field(default=0.2, gt=0, le=1)
    yolo_device: str = "auto"
    yolo_image_size: int = Field(default=960, ge=320, le=2048, multiple_of=32)
    yolo_half: bool = True
    telegram_enabled: bool = False
    telegram_bot_token: SecretStr = Field(default=SecretStr(""), repr=False)
    telegram_chat_id: str = ""

    @model_validator(mode="after")
    def telegram_credentials(self):
        if self.telegram_enabled and (
            not re.fullmatch(r"[0-9]+:[A-Za-z0-9_-]+", self.telegram_bot_token.get_secret_value())
            or not re.fullmatch(r"-[0-9]+", self.telegram_chat_id)
        ):
            raise ValueError(
                "Enabled Telegram requires a valid bot token and negative staff group chat ID."
            )
        return self

    @field_validator("database_url")
    @classmethod
    def require_psycopg(cls, value: PostgresDsn) -> PostgresDsn:
        if value.scheme != "postgresql+psycopg":
            raise ValueError("DATABASE_URL must use postgresql+psycopg")
        return value


@lru_cache
def get_settings() -> Settings:
    return Settings()
