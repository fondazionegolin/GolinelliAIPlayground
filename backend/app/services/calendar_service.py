"""Shared calendar domain logic: targets, recurring series, visibility, free-slot search.

Used by the REST endpoints (endpoints/calendar.py) and by the calendar agent (services/calendar_agent.py).
Recurring events are materialized: each occurrence is its own row (own reminder, drag and drop, edits) and all
rows of a series share ``series_id`` and the ``recurrence`` rule. Expansion runs on local wall-clock time
(Europe/Rome) so a weekly 09:00 lesson stays at 09:00 across daylight-saving changes.
"""
from __future__ import annotations

import uuid
from calendar import monthrange
from datetime import date, datetime, time, timedelta, timezone
from typing import Iterable, Literal, Optional
from zoneinfo import ZoneInfo

from fastapi import HTTPException
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import and_, delete, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.permissions import teacher_can_access_class, teacher_can_access_session
from app.models.calendar import CalendarEvent, CalendarEventTarget, SessionCalendarEvent
from app.models.enums import UserRole
from app.models.invitation import ClassTeacher, SessionTeacher
from app.models.session import Class, Session
from app.models.user import User

LOCAL_TZ = ZoneInfo("Europe/Rome")
MAX_OCCURRENCES = 200
MAX_SPAN_DAYS = 2 * 366
TargetType = Literal["class", "session", "teacher"]
Scope = Literal["one", "following", "all"]


class Recurrence(BaseModel):
    freq: Literal["daily", "weekly", "monthly"]
    interval: int = Field(default=1, ge=1, le=12)
    until: Optional[date] = None
    count: Optional[int] = Field(default=None, ge=1, le=MAX_OCCURRENCES)
    # Weekly only: Monday=0 … Sunday=6. Empty = the weekday of the first occurrence.
    weekdays: list[int] = Field(default_factory=list)

    @field_validator("weekdays")
    @classmethod
    def _weekdays(cls, value: list[int]) -> list[int]:
        return sorted({d for d in value if 0 <= d <= 6})


def aware(value: Optional[datetime]) -> Optional[datetime]:
    if value is None:
        return None
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def teacher_name(user: User) -> str:
    return f"{user.first_name or ''} {user.last_name or ''}".strip() or user.email or "Docente"


# ── Recurrence ────────────────────────────────────────────────────────────────

def expand(starts_at: datetime, ends_at: Optional[datetime], rule: Optional[Recurrence]) -> list[tuple[datetime, Optional[datetime]]]:
    """Occurrences (start, end) of a rule, first one included. Without a rule, the event itself."""
    if rule is None:
        return [(starts_at, ends_at)]
    local_start = starts_at.astimezone(LOCAL_TZ)
    duration = (ends_at - starts_at) if ends_at else None
    horizon = local_start.date() + timedelta(days=MAX_SPAN_DAYS)
    until = min(rule.until, horizon) if rule.until else horizon
    limit = rule.count or MAX_OCCURRENCES
    if not rule.until and not rule.count:
        limit = min(limit, 52 if rule.freq == "weekly" else 24 if rule.freq == "monthly" else 90)

    days: list[date] = []
    first = local_start.date()
    if rule.freq == "daily":
        day = first
        while day <= until and len(days) < limit:
            days.append(day)
            day += timedelta(days=rule.interval)
    elif rule.freq == "weekly":
        weekdays = rule.weekdays or [first.weekday()]
        week_start = first - timedelta(days=first.weekday())
        while week_start <= until and len(days) < limit:
            for wd in weekdays:
                day = week_start + timedelta(days=wd)
                if first <= day <= until and len(days) < limit:
                    days.append(day)
            week_start += timedelta(weeks=rule.interval)
    else:  # monthly, same day of month; months without that day are skipped
        y, m, k = first.year, first.month, 0
        while len(days) < limit:
            if first.day <= monthrange(y, m)[1]:
                day = date(y, m, first.day)
                if day > until:
                    break
                days.append(day)
            k += rule.interval
            m = first.month + k
            y, m = first.year + (m - 1) // 12, (m - 1) % 12 + 1
            if date(y, m, 1) > until:
                break

    wall = local_start.timetz().replace(tzinfo=None)
    out = []
    for day in days:
        start = datetime.combine(day, wall).replace(tzinfo=LOCAL_TZ).astimezone(timezone.utc)
        out.append((start, start + duration if duration is not None else None))
    return out


# ── Targets ───────────────────────────────────────────────────────────────────

async def validate_targets(db: AsyncSession, teacher: User, targets: Iterable[tuple[str, uuid.UUID]]) -> list[tuple[str, uuid.UUID]]:
    resolved: dict[tuple[str, uuid.UUID], None] = {}
    for target_type, target_id in targets:
        if target_type == "class":
            if not await teacher_can_access_class(db, teacher, target_id):
                raise HTTPException(status_code=403, detail="Classe non accessibile")
        elif target_type == "session":
            if not await teacher_can_access_session(db, teacher, target_id):
                raise HTTPException(status_code=403, detail="Sessione non accessibile")
        elif target_type == "teacher":
            if target_id == teacher.id:
                continue
            user = await db.get(User, target_id)
            if (
                not user or not user.is_active or user.tenant_id != teacher.tenant_id
                or user.role not in (UserRole.TEACHER, UserRole.ADMIN)
            ):
                raise HTTPException(status_code=400, detail="Docente non trovato")
        else:
            raise HTTPException(status_code=400, detail="Destinatario non valido")
        resolved[(target_type, target_id)] = None
    return list(resolved)


async def replace_targets(db: AsyncSession, event_id: uuid.UUID, resolved: list[tuple[str, uuid.UUID]]) -> None:
    await db.execute(delete(CalendarEventTarget).where(CalendarEventTarget.event_id == event_id))
    for target_type, target_id in resolved:
        db.add(CalendarEventTarget(event_id=event_id, target_type=target_type, target_id=target_id))


async def share_targets(db: AsyncSession, teacher: User) -> dict:
    member_class_ids = select(ClassTeacher.class_id).where(ClassTeacher.teacher_id == teacher.id)
    classes = (await db.execute(
        select(Class).where(or_(Class.teacher_id == teacher.id, Class.id.in_(member_class_ids)))
        .where(Class.is_system.is_(False)).where(Class.archived_at.is_(None)).order_by(Class.name)
    )).scalars().all()
    class_names = {cls.id: cls.name for cls in classes}
    sessions = (await db.execute(
        select(Session).where(Session.class_id.in_(list(class_names))).where(Session.deleted_at.is_(None))
        .order_by(Session.created_at.desc())
    )).scalars().all() if classes else []
    teachers = (await db.execute(
        select(User).where(
            User.tenant_id == teacher.tenant_id,
            User.role.in_((UserRole.TEACHER, UserRole.ADMIN)),
            User.is_active.is_(True),
            User.id != teacher.id,
        ).order_by(User.first_name, User.last_name, User.email)
    )).scalars().all()
    return {
        "classes": [{"id": str(cls.id), "name": cls.name} for cls in classes],
        "sessions": [
            {"id": str(session.id), "name": session.title, "class_id": str(session.class_id),
             "class_name": class_names.get(session.class_id), "status": getattr(session.status, "value", session.status)}
            for session in sessions
        ],
        "teachers": [{"id": str(user.id), "name": teacher_name(user), "email": user.email} for user in teachers],
    }


# ── Create / update / delete ──────────────────────────────────────────────────

async def create_series(
    db: AsyncSession, teacher: User, *, title: str, description: Optional[str], starts_at: datetime,
    ends_at: Optional[datetime], all_day: bool, color: str, targets: list[tuple[str, uuid.UUID]],
    recurrence: Optional[Recurrence], series_id: Optional[uuid.UUID] = None,
    voice_call_id: Optional[uuid.UUID] = None,
) -> list[CalendarEvent]:
    """Create one event, or every occurrence of a recurring one (targets must be validated)."""
    starts_at, ends_at = aware(starts_at), aware(ends_at)
    if ends_at is not None and ends_at < starts_at:
        raise HTTPException(status_code=400, detail="La fine deve seguire l'inizio")
    occurrences = expand(starts_at, ends_at, recurrence)
    if recurrence and len(occurrences) > 1:
        series_id = series_id or uuid.uuid4()
    else:
        series_id, recurrence = None, None
    rule = recurrence.model_dump(mode="json") if recurrence else None
    events = []
    for start, end in occurrences:
        event = CalendarEvent(
            tenant_id=teacher.tenant_id, owner_teacher_id=teacher.id, title=title.strip()[:200],
            description=(description or "").strip() or None, starts_at=start, ends_at=end, all_day=all_day,
            color=color or "#6366f1", series_id=series_id, recurrence=rule, voice_call_id=voice_call_id,
        )
        db.add(event)
        events.append(event)
    await db.flush()
    for event in events:
        for target_type, target_id in targets:
            db.add(CalendarEventTarget(event_id=event.id, target_type=target_type, target_id=target_id))
    return events


async def scoped_events(db: AsyncSession, event: CalendarEvent, scope: Scope) -> list[CalendarEvent]:
    if scope == "one" or not event.series_id:
        return [event]
    q = select(CalendarEvent).where(CalendarEvent.series_id == event.series_id, CalendarEvent.owner_teacher_id == event.owner_teacher_id)
    if scope == "following":
        q = q.where(CalendarEvent.starts_at >= event.starts_at)
    return list((await db.execute(q.order_by(CalendarEvent.starts_at))).scalars().all())


async def update_event(
    db: AsyncSession, teacher: User, event: CalendarEvent, data: dict, scope: Scope = "one",
) -> list[CalendarEvent]:
    """Apply a partial update to an occurrence, the following ones or the whole series.

    ``data`` keys: title, description, color, all_day, starts_at, ends_at, targets (validated list),
    recurrence (Recurrence | None), voice_call_id (validated, None detaches the call).
    Changing the rule regenerates the affected part of the series.
    """
    if "recurrence" in data:
        new_rule: Optional[Recurrence] = data["recurrence"]
        old_rule = Recurrence.model_validate(event.recurrence) if event.recurrence else None
        if (new_rule.model_dump(mode="json") if new_rule else None) != (old_rule.model_dump(mode="json") if old_rule else None):
            return await _regenerate(db, teacher, event, data, new_rule, "all" if scope == "all" else "following")

    rows = await scoped_events(db, event, scope)  # a moved single occurrence stays in its series
    new_start = aware(data.get("starts_at")) if data.get("starts_at") else None
    delta = (new_start - event.starts_at) if new_start else timedelta(0)
    duration = None
    if "ends_at" in data:
        new_end = aware(data["ends_at"])
        duration = (new_end - (new_start or event.starts_at)) if new_end else None
        if duration is not None and duration < timedelta(0):
            raise HTTPException(status_code=400, detail="La fine deve seguire l'inizio")
    targets = data.get("targets")
    for row in rows:
        for field in ("title", "color", "all_day"):
            if data.get(field) is not None:
                setattr(row, field, data[field].strip()[:200] if field == "title" else data[field])
        if "description" in data:
            row.description = (data["description"] or "").strip() or None
        if delta:
            row.starts_at = row.starts_at + delta
            row.reminder_sent_at = None
        if "ends_at" in data:
            row.ends_at = row.starts_at + duration if duration is not None else None
        elif delta and row.ends_at:
            row.ends_at = row.ends_at + delta
        if targets is not None:
            await replace_targets(db, row.id, targets)
        if "voice_call_id" in data:
            row.voice_call_id = data["voice_call_id"]
    return rows


async def _regenerate(db, teacher, event, data, rule, scope) -> list[CalendarEvent]:
    rows = await scoped_events(db, event, scope)
    anchor = rows[0] if scope == "all" else event
    start = aware(data.get("starts_at")) if data.get("starts_at") else anchor.starts_at
    if scope == "all" and data.get("starts_at"):
        start = anchor.starts_at + (aware(data["starts_at"]) - event.starts_at)
    end = aware(data["ends_at"]) if data.get("ends_at") else (anchor.ends_at + (start - anchor.starts_at) if anchor.ends_at else None)
    if scope == "all" and data.get("ends_at"):
        end = start + (aware(data["ends_at"]) - aware(data.get("starts_at") or event.starts_at))
    targets = data.get("targets")
    if targets is None:
        targets = [(t.target_type, t.target_id) for t in (await db.execute(
            select(CalendarEventTarget).where(CalendarEventTarget.event_id == event.id))).scalars().all()]
    created = await create_series(
        db, teacher,
        title=data.get("title") or event.title,
        description=data["description"] if "description" in data else event.description,
        starts_at=start, ends_at=end,
        all_day=data["all_day"] if data.get("all_day") is not None else event.all_day,
        color=data.get("color") or event.color, targets=targets, recurrence=rule,
        voice_call_id=data["voice_call_id"] if "voice_call_id" in data else event.voice_call_id,
    )
    for row in rows:
        await db.delete(row)
    return created


# ── Visibility / busy times ───────────────────────────────────────────────────

def teacher_class_ids(teacher_id):
    """Classes a teacher owns or co-teaches (subquery)."""
    return select(Class.id).where(or_(
        Class.teacher_id == teacher_id,
        Class.id.in_(select(ClassTeacher.class_id).where(ClassTeacher.teacher_id == teacher_id)),
    ))


def teacher_session_ids(teacher_id):
    """Sessions of those classes plus sessions the teacher was invited to directly (subquery)."""
    return select(Session.id).where(or_(
        Session.class_id.in_(teacher_class_ids(teacher_id)),
        Session.id.in_(select(SessionTeacher.session_id).where(SessionTeacher.teacher_id == teacher_id)),
    ))


def teacher_visibility(teacher: User):
    """Own events, events naming the teacher, and events shared with a class/session the teacher (co-)teaches:
    a co-teacher sees what a colleague planned for their shared class, like the students do."""
    invited = select(CalendarEventTarget.event_id).where(or_(
        and_(CalendarEventTarget.target_type == "teacher", CalendarEventTarget.target_id == teacher.id),
        and_(CalendarEventTarget.target_type == "class", CalendarEventTarget.target_id.in_(teacher_class_ids(teacher.id))),
        and_(CalendarEventTarget.target_type == "session", CalendarEventTarget.target_id.in_(teacher_session_ids(teacher.id))),
    ))
    return or_(CalendarEvent.owner_teacher_id == teacher.id, CalendarEvent.id.in_(invited))


async def audience_busy(
    db: AsyncSession, teacher: User, session_ids: set[uuid.UUID], class_ids: set[uuid.UUID],
    start: datetime, end: datetime,
) -> list[dict]:
    """Every event that keeps the teacher, the given sessions or classes busy in [start, end)."""
    sessions = (await db.execute(
        select(Session).where(or_(Session.id.in_(session_ids), Session.class_id.in_(class_ids)))
        .where(Session.deleted_at.is_(None))
    )).scalars().all() if (session_ids or class_ids) else []
    all_session_ids = {s.id for s in sessions} | session_ids
    all_class_ids = {s.class_id for s in sessions} | class_ids
    audience = []
    if all_session_ids:
        audience.append(and_(CalendarEventTarget.target_type == "session", CalendarEventTarget.target_id.in_(all_session_ids)))
    if all_class_ids:
        audience.append(and_(CalendarEventTarget.target_type == "class", CalendarEventTarget.target_id.in_(all_class_ids)))
    visibility = teacher_visibility(teacher)
    if audience:
        visibility = or_(visibility, CalendarEvent.id.in_(select(CalendarEventTarget.event_id).where(or_(*audience))))
    events = (await db.execute(
        select(CalendarEvent).where(visibility).where(CalendarEvent.starts_at < end)
        .where(func.coalesce(CalendarEvent.ends_at, CalendarEvent.starts_at) >= start)
        .order_by(CalendarEvent.starts_at).limit(500)
    )).scalars().all()
    busy = [{
        "id": str(e.id), "title": e.title, "start": e.starts_at, "end": e.ends_at or e.starts_at + timedelta(hours=1),
        "all_day": e.all_day, "mine": e.owner_teacher_id == teacher.id, "series_id": str(e.series_id) if e.series_id else None,
    } for e in events]
    if all_session_ids:
        legacy = (await db.execute(
            select(SessionCalendarEvent).where(SessionCalendarEvent.session_id.in_(all_session_ids))
            .where(SessionCalendarEvent.event_date >= (start - timedelta(days=1)).date())
            .where(SessionCalendarEvent.event_date <= (end + timedelta(days=1)).date())
        )).scalars().all()
        for e in legacy:
            s = datetime.combine(e.event_date, e.event_time or time(0)).replace(tzinfo=LOCAL_TZ)
            busy.append({"id": f"session-{e.id}", "title": e.title, "start": s, "end": s + (timedelta(hours=1) if e.event_time else timedelta(days=1)),
                         "all_day": e.event_time is None, "mine": False, "series_id": None})
    return busy


def free_slots(
    busy: list[dict], *, from_day: date, to_day: date, duration_min: int, hours: tuple[int, int] = (8, 19),
    weekdays: Iterable[int] = (0, 1, 2, 3, 4), step_min: int = 30, per_day: int = 3, limit: int = 15,
    not_before: Optional[datetime] = None,
) -> list[dict]:
    """Free windows of ``duration_min`` inside working hours; all-day events block the whole day."""
    weekdays = set(weekdays)
    intervals = [(b["start"], b["end"]) for b in busy if not b["all_day"]]
    blocked_days = set()
    for b in busy:
        if b["all_day"]:
            d = b["start"].astimezone(LOCAL_TZ).date()
            while d <= b["end"].astimezone(LOCAL_TZ).date():
                blocked_days.add(d)
                d += timedelta(days=1)
    out: list[dict] = []
    day = from_day
    while day <= to_day and len(out) < limit:
        if day.weekday() in weekdays and day not in blocked_days:
            found = 0
            minutes = hours[0] * 60
            while minutes + duration_min <= hours[1] * 60 and found < per_day:
                start = datetime.combine(day, time(minutes // 60, minutes % 60)).replace(tzinfo=LOCAL_TZ)
                end = start + timedelta(minutes=duration_min)
                if (not not_before or start >= not_before) and all(end <= s or start >= e for s, e in intervals):
                    out.append({"start": start.isoformat(), "end": end.isoformat()})
                    found += 1
                    minutes += duration_min  # next candidate after this slot
                else:
                    minutes += step_min
        day += timedelta(days=1)
    return out
