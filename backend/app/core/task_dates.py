from datetime import datetime, timezone


def task_due_at_for_storage(value: datetime | None) -> datetime | None:
    """Store task deadlines as naive UTC for the existing database column."""
    if value is None or value.tzinfo is None:
        return value
    return value.astimezone(timezone.utc).replace(tzinfo=None)


def task_due_at_iso(value: datetime | None) -> str | None:
    """Expose stored task deadlines as explicit UTC timestamps."""
    if value is None:
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc).isoformat()
