from datetime import datetime, timedelta, timezone

from app.core.task_dates import task_due_at_for_storage, task_due_at_iso


def test_task_due_at_for_storage_converts_aware_value_to_naive_utc():
    local_value = datetime(2026, 7, 13, 10, 30, tzinfo=timezone(timedelta(hours=2)))

    assert task_due_at_for_storage(local_value) == datetime(2026, 7, 13, 8, 30)


def test_task_due_at_iso_marks_stored_value_as_utc():
    stored_value = datetime(2026, 7, 13, 8, 30)

    assert task_due_at_iso(stored_value) == "2026-07-13T08:30:00+00:00"


def test_task_due_at_helpers_preserve_empty_deadline():
    assert task_due_at_for_storage(None) is None
    assert task_due_at_iso(None) is None
