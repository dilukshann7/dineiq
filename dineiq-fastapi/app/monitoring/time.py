"""UTC timestamps shared by monitoring snapshots and staff alerts."""

from datetime import UTC, datetime


def timestamp(value: float | None) -> str | None:
    return datetime.fromtimestamp(value, UTC).isoformat() if value is not None else None
