import json
import math
from dataclasses import dataclass
from http.client import HTTPException
from threading import Lock
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from sqlalchemy.exc import SQLAlchemyError
from sqlmodel import Session, select

from app.alerts.configuration import read_telegram_settings
from app.models.monitoring import StaffAlert


@dataclass(frozen=True)
class DeliveryResult:
    message_id: int | None = None
    error: str | None = None
    retryable: bool = False
    retry_after: float = 0


def failure(code, data=None):
    if code == 429:
        parameters = (data or {}).get("parameters")
        delay = parameters.get("retry_after", 0) if isinstance(parameters, dict) else 0
        try:
            delay = delay if isinstance(delay, (int, float)) and math.isfinite(delay) else 0
        except OverflowError:
            delay = 0
        return DeliveryResult(error="rate_limited", retryable=True, retry_after=max(0, delay))
    return DeliveryResult(
        error={400: "invalid_request", 401: "unauthorized", 403: "forbidden"}.get(
            code, "telegram_unavailable" if code >= 500 else "telegram_rejected"
        ),
        retryable=code >= 500,
    )


def send_message(settings, text):
    token = settings.telegram_bot_token.get_secret_value()
    request = Request(
        f"https://api.telegram.org/bot{token}/sendMessage",
        data=json.dumps({"chat_id": settings.telegram_chat_id, "text": text}).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urlopen(request, timeout=5) as response:
            body = response.read(65_537)
        if len(body) > 65_536:
            return DeliveryResult(error="invalid_response", retryable=True)
        data = json.loads(body)
        if not isinstance(data, dict):
            return DeliveryResult(error="invalid_response", retryable=True)
        if data.get("ok") is not True:
            code = data.get("error_code", 500)
            return failure(code if isinstance(code, int) else 500, data)
        result = data.get("result")
        message_id = result.get("message_id") if isinstance(result, dict) else None
        if type(message_id) is not int:
            return DeliveryResult(error="invalid_response", retryable=True)
        return DeliveryResult(message_id=message_id)
    except HTTPError as exc:
        data = None
        try:
            body = exc.read(65_537)
            parsed = json.loads(body) if len(body) <= 65_536 else None
            data = parsed if isinstance(parsed, dict) else None
        except (ValueError, OSError, AttributeError, HTTPException):
            pass
        finally:
            exc.close()
        return failure(exc.code, data)
    except (URLError, OSError, HTTPException):
        return DeliveryResult(error="network_error", retryable=True)
    except (ValueError, TypeError):
        return DeliveryResult(error="invalid_response", retryable=True)


def alert_text(alert):
    from app.alerts.service import stamp

    title = " ".join(alert.table_name.split())
    if alert.kind == "service":
        reason = (
            "Initial service unconfirmed after 5 minutes. "
            f"Arrival: {stamp(alert.details['arrived_at'])} (UTC)."
        )
    else:
        reason = (
            "Needs cleaning — estimate. Please inspect. Detected items: "
            + (", ".join(alert.details.get("items", [])) or "manual correction")
            + "."
        )
    return f"DineIQ | {title}\n{reason}\nAlert: {alert.id}\nConfirm in the staff dashboard."


class TelegramDelivery:
    def __init__(self, monitor, settings):
        self.monitor = monitor
        self.settings = settings
        self.dispatch_lock = Lock()
        self.next_send_at = 0

    def tick(self):
        if not self.monitor.initialized or not self.dispatch_lock.acquire(blocking=False):
            return
        try:
            self.monitor.alerts.evaluate()
            with Session(self.monitor.engine) as db:
                settings = read_telegram_settings(db, self.settings)
            claimed = self.claim(settings)
            if claimed:
                alert_id, text = claimed
                result = send_message(settings, text)
                self.complete(alert_id, result)
        except SQLAlchemyError:
            self.monitor.database_failed()
        finally:
            self.dispatch_lock.release()

    def claim(self, settings=None):
        now = self.monitor.clock()
        with self.monitor.lock, Session(self.monitor.engine) as db:
            settings = settings or read_telegram_settings(db, self.settings)
            alerts = db.exec(
                select(StaffAlert)
                .where(
                    StaffAlert.resolved_at.is_(None),
                    StaffAlert.delivery_status.in_(["pending", "sending"]),
                )
                .order_by(StaffAlert.created_at, StaffAlert.id)
            ).all()
            claimed = None
            for alert in alerts:
                if now - alert.created_at >= 900:
                    alert.delivery_status = "expired"
                    alert.last_error = "delivery_expired"
                    db.add(alert)
                    self.monitor.alerts.event(db, alert, "alert_delivery_expired")
                elif (
                    claimed is None
                    and settings.telegram_enabled
                    and now >= self.next_send_at
                    and now >= alert.next_retry_at
                    and alert.delivery_status == "pending"
                    and self.monitor.alerts.eligible(db, alert)
                ):
                    alert.delivery_status = "sending"
                    alert.attempts += 1
                    db.add(alert)
                    claimed = (alert.id, alert_text(alert))
            db.commit()
            if claimed:
                self.next_send_at = now + 3
            return claimed

    def complete(self, alert_id, result):
        with self.monitor.lock, Session(self.monitor.engine) as db:
            alert = db.get(StaffAlert, alert_id)
            if not alert:
                return
            if result.message_id is not None:
                alert.telegram_message_id = result.message_id
                alert.delivery_status = "sent"
                alert.last_error = None
                event = "alert_delivered"
            elif alert.resolved_at is not None:
                return
            else:
                alert.last_error = result.error
                retry = result.retryable and alert.attempts < 5
                alert.delivery_status = "pending" if retry else "failed"
                alert.next_retry_at = self.monitor.clock() + max(
                    5 * 2 ** (alert.attempts - 1), result.retry_after
                )
                if result.error == "rate_limited":
                    self.next_send_at = max(self.next_send_at, alert.next_retry_at)
                event = "alert_delivery_retry" if retry else "alert_delivery_failed"
            db.add(alert)
            self.monitor.alerts.event(db, alert, event)
            db.commit()
