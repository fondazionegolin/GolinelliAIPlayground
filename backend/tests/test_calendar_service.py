"""Recurrence expansion, free-slot search and Decisions-router calendar handling (no database)."""
from datetime import date, datetime, timedelta, timezone

from app.services.calendar_service import LOCAL_TZ, Recurrence, expand, free_slots


def _local(y, m, d, hh=9, mm=0):
    return datetime(y, m, d, hh, mm, tzinfo=LOCAL_TZ).astimezone(timezone.utc)


def test_weekly_keeps_wall_clock_across_dst_and_respects_until():
    start = _local(2026, 10, 19, 9)  # Monday, CEST
    occ = expand(start, start + timedelta(hours=1), Recurrence(freq="weekly", weekdays=[0, 3], until=date(2026, 11, 5)))
    local = [s.astimezone(LOCAL_TZ) for s, _ in occ]
    assert [d.strftime("%a %d/%m") for d in local] == ["Mon 19/10", "Thu 22/10", "Mon 26/10", "Thu 29/10", "Mon 02/11", "Thu 05/11"]
    assert all(d.hour == 9 for d in local)  # 09:00 before and after the October DST change
    assert all(e - s == timedelta(hours=1) for s, e in occ)


def test_monthly_skips_missing_days_and_count_limits():
    start = _local(2027, 1, 31, 15)
    occ = expand(start, None, Recurrence(freq="monthly", count=4))
    assert [s.astimezone(LOCAL_TZ).strftime("%m-%d") for s, _ in occ] == ["01-31", "03-31", "05-31", "07-31"]


def test_no_rule_is_a_single_event_and_open_ended_rules_are_capped():
    start = _local(2026, 11, 10)
    assert expand(start, None, None) == [(start, None)]
    assert len(expand(start, None, Recurrence(freq="daily"))) == 90
    assert len(expand(start, None, Recurrence(freq="weekly"))) == 52


def test_free_slots_avoid_busy_and_all_day_events():
    busy = [
        {"start": _local(2026, 11, 16, 8), "end": _local(2026, 11, 16, 10), "all_day": False},
        {"start": _local(2026, 11, 17, 0), "end": _local(2026, 11, 17, 23, 59), "all_day": True},
    ]
    slots = free_slots(busy, from_day=date(2026, 11, 16), to_day=date(2026, 11, 17), duration_min=60, hours=(8, 12))
    starts = [s["start"][:16] for s in slots]
    assert starts == ["2026-11-16T10:00", "2026-11-16T11:00"]  # Monday after the busy block; Tuesday blocked
