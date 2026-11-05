import re
from dataclasses import dataclass, field

from fastapi import HTTPException
from pydantic import Field, SecretStr, field_validator

from app.auth.contracts import Input
from app.auth.service import record_activity
from app.models.settings import TelegramConfiguration


class TelegramInput(Input):
    enabled: bool
    chat_id: str = Field(max_length=64)
    bot_token: SecretStr | None = Field(default=None, repr=False)

    @field_validator("chat_id")
    @classmethod
    def group_chat(cls, value):
        value = value.strip()
        if value and not re.fullmatch(r"-[0-9]+", value):
            raise ValueError("Use the negative chat ID of your staff group.")
        return value

    @field_validator("bot_token")
    @classmethod
    def valid_token(cls, value):
        if value is None:
            return None
        token = value.get_secret_value().strip()
        if not token:
            return None
        if len(token) > 256 or not re.fullmatch(r"[0-9]+:[A-Za-z0-9_-]+", token):
            raise ValueError("Enter a valid Telegram bot token.")
        return SecretStr(token)


@dataclass(frozen=True)
class TelegramSettings:
    telegram_enabled: bool
    telegram_chat_id: str
    telegram_bot_token: SecretStr = field(repr=False)

    def public(self):
        return {
            "enabled": self.telegram_enabled,
            "chat_id": self.telegram_chat_id,
            "bot_token_configured": bool(self.telegram_bot_token.get_secret_value()),
        }


def read_telegram_settings(db, defaults):
    saved = db.get(TelegramConfiguration, 1)
    if saved is None:
        return TelegramSettings(
            defaults.telegram_enabled, defaults.telegram_chat_id, defaults.telegram_bot_token
        )
    return TelegramSettings(saved.enabled, saved.chat_id, SecretStr(saved.bot_token))


def save_telegram_settings(db, defaults, actor, data):
    previous = read_telegram_settings(db, defaults)
    token = data.bot_token or previous.telegram_bot_token
    if data.enabled and (
        len(token.get_secret_value()) > 256
        or not re.fullmatch(r"[0-9]+:[A-Za-z0-9_-]+", token.get_secret_value())
        or not data.chat_id
    ):
        raise HTTPException(
            422, "Set a valid bot token and staff group chat ID before enabling alerts."
        )
    record_activity(
        db,
        actor,
        "telegram_settings_updated",
        data={
            "enabled": data.enabled,
            "chat_id_changed": data.chat_id != previous.telegram_chat_id,
            "bot_token_changed": token != previous.telegram_bot_token,
        },
    )
    saved = db.get(TelegramConfiguration, 1) or TelegramConfiguration()
    saved.enabled, saved.chat_id, saved.bot_token = (
        data.enabled,
        data.chat_id,
        token.get_secret_value(),
    )
    db.add(saved)
    db.commit()
    return read_telegram_settings(db, defaults).public()
