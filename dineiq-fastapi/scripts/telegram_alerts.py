import argparse
import json
import sys
from http.client import HTTPException
from pathlib import Path
from urllib.error import URLError
from urllib.request import Request, urlopen

from pydantic import ValidationError
from sqlalchemy.exc import SQLAlchemyError
from sqlmodel import Session

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.alerts.configuration import read_telegram_settings  # noqa: E402
from app.alerts.delivery import send_message  # noqa: E402
from app.core.config import Settings  # noqa: E402
from app.db.session import create_db_engine  # noqa: E402


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=["chat-id", "send-test"])
    args = parser.parse_args(argv)
    try:
        settings = Settings()
    except ValidationError:
        print(
            "Invalid configuration. Check backend .env; "
            "keep TELEGRAM_ENABLED=false while discovering the group ID.",
            file=sys.stderr,
        )
        return 1
    engine = create_db_engine(settings)
    try:
        with Session(engine) as db:
            settings = read_telegram_settings(db, settings)
    except SQLAlchemyError:
        print("Cannot load Telegram settings. Check the database and migrations.", file=sys.stderr)
        return 1
    finally:
        engine.dispose()
    if args.command == "send-test":
        if not settings.telegram_enabled:
            print(
                "Enable Telegram alerts with a bot token and group chat ID in Settings first.",
                file=sys.stderr,
            )
            return 1
        result = send_message(
            settings, "DineIQ test: staff alerts are connected. No table action is required."
        )
        if result.message_id is None:
            print(f"Test delivery failed: {result.error}.", file=sys.stderr)
            return 1
        print(f"Test delivered. Telegram message ID: {result.message_id}.")
        return 0
    token = settings.telegram_bot_token.get_secret_value()
    if not token:
        print("Save a bot token in Settings first.", file=sys.stderr)
        return 1
    request = Request(
        f"https://api.telegram.org/bot{token}/getUpdates",
        data=b'{"timeout":0,"limit":100}',
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urlopen(request, timeout=5) as response:
            body = response.read(65_537)
        if len(body) > 65_536:
            raise ValueError("Oversized response")
        data = json.loads(body)
        if (
            not isinstance(data, dict)
            or data.get("ok") is not True
            or not isinstance(data.get("result"), list)
        ):
            raise ValueError("Invalid response")
    except (URLError, OSError, ValueError, HTTPException):
        print(
            "Could not read Telegram updates. Check the token, connection, "
            "and whether another application uses this bot's webhook or polling.",
            file=sys.stderr,
        )
        return 1
    groups = {}
    for update in data["result"]:
        if not isinstance(update, dict):
            continue
        for key in ("message", "my_chat_member"):
            event = update.get(key)
            chat = event.get("chat") if isinstance(event, dict) else None
            if (
                isinstance(chat, dict)
                and chat.get("type") in ("group", "supergroup")
                and type(chat.get("id")) is int
            ):
                groups[chat["id"]] = " ".join(str(chat.get("title", "Staff group")).split())
    for chat_id, title in groups.items():
        print(f"{title}: {chat_id}")
    if not groups:
        print(
            "No staff group found. Add the bot, "
            "send /start@YourBotUsername in the group, and retry."
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
