"""UTC timestamps shared by monitoring snapshots and staff alerts."""

from datetime import UTC, datetime

# Match the existing capture watchdog and dashboard freshness window. Serialized
# inference can legitimately deliver observations more than two seconds apart.
OBSERVATION_TIMEOUT_SECONDS = 5


def timestamp(value: float | None) -> str | None:
    return datetime.fromtimestamp(value, UTC).isoformat() if value is not None else None
