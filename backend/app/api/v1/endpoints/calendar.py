from datetime import date, datetime, time, timedelta, timezone
from typing import Annotated, Literal, Optional
import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import and_, delete, func, or_, select, nullslast
from sqlalchemy.ext.asyncio import AsyncSession

from fastapi import File as UploadField, Form, UploadFile

from app.api.deps import get_db, get_student_or_teacher, StudentOrTeacher
from app.core.permissions import teacher_can_access_session
from app.models.calendar import CalendarEvent, CalendarEventTarget, SessionCalendarEvent
from app.models.session import Class, Session
from app.models.user import User
from app.models.voice_call import VoiceCall
from app.services import calendar_service as cal
from app.services.voice_calls import is_live as voice_call_live
from app.services.calendar_service import Recurrence, Scope

router = APIRouter(prefix="/calendar")


# ── Schemas ───────────────────────────────────────────────────────────────────

class EventOut(BaseModel):
    id: uuid.UUID
    session_id: uuid.UUID
    title: str
    description: Optional[str]
    event_date: date
    event_time: Optional[time] = None
    color: str
    created_by_teacher_id: Optional[uuid.UUID]

    class Config:
        from_attributes = True


class EventCreate(BaseModel):
    title: str
    description: Optional[str] = None
    event_date: date
    event_time: Optional[time] = None
    color: str = "#6366f1"


class EventUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    event_date: Optional[date] = None
    event_time: Optional[time] = None
    color: Optional[str] = None


# ── Helpers ───────────────────────────────────────────────────────────────────

async def _get_session_or_404(session_id: uuid.UUID, actor: StudentOrTeacher, db: AsyncSession) -> Session:
    result = await db.execute(select(Session).where(Session.id == session_id))
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    if actor.is_teacher:
        if session.tenant_id != actor.teacher.tenant_id:
            raise HTTPException(status_code=403, detail="Access denied")
    elif actor.is_student:
        if actor.student.session_id != session_id:
            raise HTTPException(status_code=403, detail="Access denied")

    return session


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("/session/{session_id}/events", response_model=list[EventOut])
async def list_events(
    session_id: uuid.UUID,
    from_date: Optional[date] = None,
    to_date: Optional[date] = None,
    actor: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)] = None,
    db: Annotated[AsyncSession, Depends(get_db)] = None,
):
    await _get_session_or_404(session_id, actor, db)

    q = select(SessionCalendarEvent).where(SessionCalendarEvent.session_id == session_id)
    if from_date:
        q = q.where(SessionCalendarEvent.event_date >= from_date)
    if to_date:
        q = q.where(SessionCalendarEvent.event_date <= to_date)
    q = q.order_by(
        SessionCalendarEvent.event_date,
        nullslast(SessionCalendarEvent.event_time),
    )

    result = await db.execute(q)
    return result.scalars().all()


@router.post("/session/{session_id}/events", response_model=EventOut, status_code=201)
async def create_event(
    session_id: uuid.UUID,
    body: EventCreate,
    actor: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)] = None,
    db: Annotated[AsyncSession, Depends(get_db)] = None,
):
    if not actor.is_teacher:
        raise HTTPException(status_code=403, detail="Teacher access required")

    session = await _get_session_or_404(session_id, actor, db)

    event = SessionCalendarEvent(
        session_id=session_id,
        tenant_id=session.tenant_id,
        title=body.title,
        description=body.description,
        event_date=body.event_date,
        event_time=body.event_time,
        color=body.color,
        created_by_teacher_id=actor.teacher.id,
    )
    db.add(event)
    await db.commit()
    await db.refresh(event)
    return event


@router.patch("/session/{session_id}/events/{event_id}", response_model=EventOut)
async def update_event(
    session_id: uuid.UUID,
    event_id: uuid.UUID,
    body: EventUpdate,
    actor: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)] = None,
    db: Annotated[AsyncSession, Depends(get_db)] = None,
):
    if not actor.is_teacher:
        raise HTTPException(status_code=403, detail="Teacher access required")

    await _get_session_or_404(session_id, actor, db)

    result = await db.execute(
        select(SessionCalendarEvent)
        .where(SessionCalendarEvent.id == event_id)
        .where(SessionCalendarEvent.session_id == session_id)
    )
    event = result.scalar_one_or_none()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")

    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(event, field, value)

    await db.commit()
    await db.refresh(event)
    return event


@router.delete("/session/{session_id}/events/{event_id}", status_code=204)
async def delete_event(
    session_id: uuid.UUID,
    event_id: uuid.UUID,
    actor: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)] = None,
    db: Annotated[AsyncSession, Depends(get_db)] = None,
):
    if not actor.is_teacher:
        raise HTTPException(status_code=403, detail="Teacher access required")

    await _get_session_or_404(session_id, actor, db)

    result = await db.execute(
        select(SessionCalendarEvent)
        .where(SessionCalendarEvent.id == event_id)
        .where(SessionCalendarEvent.session_id == session_id)
    )
    event = result.scalar_one_or_none()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")

    await db.delete(event)
    await db.commit()


# ══ Shared calendar events (navbar calendar) ═════════════════════════════════
#
# Teachers create events and share them with classes (every session of the class), single sessions
# and co-teachers. Students see events shared with their session or its class; teachers see their own
# events and those they were invited to. A reminder goes out 10 minutes before the start
# (services/calendar_reminders.py). Domain logic lives in services/calendar_service.py.

TargetType = Literal["class", "session", "teacher"]


class SharedTargetIn(BaseModel):
    target_type: TargetType
    target_id: uuid.UUID


class SharedEventIn(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    description: Optional[str] = Field(default=None, max_length=5000)
    starts_at: datetime
    ends_at: Optional[datetime] = None
    all_day: bool = False
    color: str = Field(default="#6366f1", max_length=20)
    targets: list[SharedTargetIn] = Field(default_factory=list, max_length=200)
    recurrence: Optional[Recurrence] = None
    # Class video call: link an existing call of yours, or create a new one for this event.
    voice_call_id: Optional[uuid.UUID] = None
    with_voice_call: bool = False


class SharedEventPatch(BaseModel):
    title: Optional[str] = Field(default=None, min_length=1, max_length=200)
    description: Optional[str] = Field(default=None, max_length=5000)
    starts_at: Optional[datetime] = None
    ends_at: Optional[datetime] = None
    all_day: Optional[bool] = None
    color: Optional[str] = Field(default=None, max_length=20)
    targets: Optional[list[SharedTargetIn]] = Field(default=None, max_length=200)
    recurrence: Optional[Recurrence] = None
    voice_call_id: Optional[uuid.UUID] = None  # explicit null detaches the call
    with_voice_call: bool = False


def _require_teacher(actor: StudentOrTeacher) -> User:
    if not actor.is_teacher:
        raise HTTPException(status_code=403, detail="Teacher access required")
    return actor.teacher


async def serialize_events(db: AsyncSession, events: list[CalendarEvent], viewer_teacher_id: Optional[uuid.UUID]) -> list[dict]:
    if not events:
        return []
    event_ids = [event.id for event in events]
    targets = (await db.execute(
        select(CalendarEventTarget).where(CalendarEventTarget.event_id.in_(event_ids))
    )).scalars().all()
    ids_by_type: dict[str, set[uuid.UUID]] = {"class": set(), "session": set(), "teacher": set()}
    for target in targets:
        ids_by_type.setdefault(target.target_type, set()).add(target.target_id)
    owner_ids = {event.owner_teacher_id for event in events}
    labels: dict[uuid.UUID, str] = {}
    if ids_by_type["class"]:
        for cls in (await db.execute(select(Class).where(Class.id.in_(ids_by_type["class"])))).scalars():
            labels[cls.id] = cls.name
    if ids_by_type["session"]:
        for session in (await db.execute(select(Session).where(Session.id.in_(ids_by_type["session"])))).scalars():
            labels[session.id] = session.title
    user_ids = ids_by_type["teacher"] | owner_ids
    if user_ids:
        for user in (await db.execute(select(User).where(User.id.in_(user_ids)))).scalars():
            labels[user.id] = cal.teacher_name(user)
    by_event: dict[uuid.UUID, list[dict]] = {}
    for target in targets:
        by_event.setdefault(target.event_id, []).append({
            "target_type": target.target_type,
            "target_id": str(target.target_id),
            "label": labels.get(target.target_id) or {"class": "Classe", "session": "Sessione"}.get(target.target_type, "Docente"),
        })
    is_owner = lambda event: viewer_teacher_id is not None and event.owner_teacher_id == viewer_teacher_id
    call_ids = {event.voice_call_id for event in events if event.voice_call_id}
    calls = {
        call.id: call for call in (await db.execute(select(VoiceCall).where(VoiceCall.id.in_(call_ids)))).scalars()
    } if call_ids else {}

    def call_payload(event: CalendarEvent):
        call = calls.get(event.voice_call_id) if event.voice_call_id else None
        # A disabled link is shown only to teachers (the owner can re-enable it from the event).
        if not call or (viewer_teacher_id is None and not call.link_enabled):
            return None
        return {"id": str(call.id), "code": call.code, "title": call.title, "join_path": f"/call/{call.code}",
                "link_enabled": call.link_enabled, "live": voice_call_live(call.id)}

    return [
        {
            "id": str(event.id),
            "source": "event",
            "title": event.title,
            "description": event.description,
            "starts_at": event.starts_at.isoformat(),
            "ends_at": event.ends_at.isoformat() if event.ends_at else None,
            "all_day": event.all_day,
            "color": event.color,
            "owner_teacher_id": str(event.owner_teacher_id),
            "owner_name": labels.get(event.owner_teacher_id, "Docente"),
            "can_edit": is_owner(event),
            "series_id": str(event.series_id) if event.series_id else None,
            "recurrence": event.recurrence,
            "created_at": event.created_at.isoformat() if event.created_at else None,
            "updated_at": event.updated_at.isoformat() if event.updated_at else None,
            # Students never see who else (teachers, other classes) an event is shared with.
            "targets": by_event.get(event.id, []) if viewer_teacher_id is not None else [],
            "voice_call": call_payload(event),
        }
        for event in events
    ]


def _legacy_event_payload(event: SessionCalendarEvent) -> dict:
    """Older per-session events (desktop widgets): local wall-clock date/time, read-only here."""
    start = datetime.combine(event.event_date, event.event_time or time(0, 0))
    return {
        "id": f"session-{event.id}",
        "source": "session",
        "title": event.title,
        "description": event.description,
        "starts_at": start.isoformat(),
        "ends_at": None,
        "all_day": event.event_time is None,
        "color": event.color,
        "owner_teacher_id": str(event.created_by_teacher_id) if event.created_by_teacher_id else None,
        "owner_name": None,
        "can_edit": False,
        "series_id": None,
        "recurrence": None,
        "created_at": event.created_at.isoformat() if event.created_at else None,
        "updated_at": event.updated_at.isoformat() if event.updated_at else None,
        "targets": [],
        "voice_call": None,
    }


@router.get("/share-targets")
async def shared_event_targets(
    actor: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Classes, sessions and colleagues a teacher can share an event with."""
    return await cal.share_targets(db, _require_teacher(actor))


@router.get("/events")
async def list_shared_events(
    actor: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
    db: Annotated[AsyncSession, Depends(get_db)],
    start: datetime,
    end: datetime,
    session_id: Optional[uuid.UUID] = None,
):
    """Events visible to the caller overlapping [start, end), plus the legacy events of `session_id`."""
    start, end = cal.aware(start), cal.aware(end)
    if end <= start or end - start > timedelta(days=200):
        raise HTTPException(status_code=400, detail="Intervallo non valido")

    if actor.is_teacher:
        teacher = actor.teacher
        visibility = cal.teacher_visibility(teacher)
        legacy_session_id = session_id if session_id and await teacher_can_access_session(db, teacher, session_id) else None
        viewer_teacher_id = teacher.id
    else:
        student_session = await db.get(Session, actor.student.session_id)
        clauses = [and_(CalendarEventTarget.target_type == "session", CalendarEventTarget.target_id == actor.student.session_id)]
        if student_session:
            clauses.append(and_(CalendarEventTarget.target_type == "class", CalendarEventTarget.target_id == student_session.class_id))
        visibility = CalendarEvent.id.in_(select(CalendarEventTarget.event_id).where(or_(*clauses)))
        legacy_session_id = actor.student.session_id
        viewer_teacher_id = None

    events = (await db.execute(
        select(CalendarEvent)
        .where(visibility)
        .where(CalendarEvent.starts_at < end)
        .where(func.coalesce(CalendarEvent.ends_at, CalendarEvent.starts_at) >= start)
        .order_by(CalendarEvent.starts_at)
        .limit(1000)
    )).scalars().all()
    items = await serialize_events(db, list(events), viewer_teacher_id)

    if legacy_session_id:
        # Legacy dates are naive local days: a one-day margin on each side, the client clips precisely.
        legacy = (await db.execute(
            select(SessionCalendarEvent)
            .where(SessionCalendarEvent.session_id == legacy_session_id)
            .where(SessionCalendarEvent.event_date >= (start - timedelta(days=1)).date())
            .where(SessionCalendarEvent.event_date <= (end + timedelta(days=1)).date())
        )).scalars().all()
        items.extend(_legacy_event_payload(event) for event in legacy)
    return items


async def owned_event(db: AsyncSession, teacher: User, event_id: uuid.UUID) -> CalendarEvent:
    event = await db.get(CalendarEvent, event_id)
    if not event:
        raise HTTPException(status_code=404, detail="Evento non trovato")
    if event.owner_teacher_id != teacher.id:
        raise HTTPException(status_code=403, detail="Solo chi ha creato l'evento può modificarlo")
    return event


async def broadcast_changed(rooms: set[str], event_id, owner_id: uuid.UUID, action: str, title: str = "") -> None:
    """Tell every recipient's open calendar to refetch (best effort); the navbar badges new events."""
    try:
        from app.realtime.gateway import sio
        payload = {
            "event_id": f"calendar:{event_id}:{action}:{datetime.now(timezone.utc).timestamp()}",
            "calendar_event_id": str(event_id),
            "action": action,
            "actor_teacher_id": str(owner_id),
            "title": title,
        }
        for room in rooms:
            await sio.emit("calendar_changed", payload, room=room)
    except Exception as exc:  # pragma: no cover - realtime is optional
        print(f"[calendar] change broadcast failed: {exc}")


async def rooms_for(db: AsyncSession, events: list[CalendarEvent]) -> set[str]:
    from app.services.calendar_reminders import event_rooms
    rooms: set[str] = set()
    seen_series: set = set()
    for event in events:
        key = event.series_id or event.id
        if key in seen_series:
            continue  # all occurrences of a series share their targets
        seen_series.add(key)
        rooms.update(await event_rooms(db, event.id, event.owner_teacher_id))
    return rooms


async def resolve_voice_call(
    db: AsyncSession, teacher: User, *, voice_call_id: Optional[uuid.UUID], with_voice_call: bool, title: str,
    resolved_targets: list[tuple[str, uuid.UUID]], current: Optional[uuid.UUID] = None,
) -> Optional[uuid.UUID]:
    """Validate a linked call (must be yours) or create a new one; its audience follows the event targets."""
    if voice_call_id:
        if voice_call_id == current:
            return voice_call_id
        call = await db.get(VoiceCall, voice_call_id)
        if not call or call.owner_teacher_id != teacher.id:
            raise HTTPException(status_code=403, detail="Puoi collegare solo videochiamate create da te")
        return call.id
    if with_voice_call:
        if current:
            return current
        from app.api.v1.endpoints.voice_calls import create_call
        session_ids = [tid for ttype, tid in resolved_targets if ttype == "session"]
        class_ids = [tid for ttype, tid in resolved_targets if ttype == "class"]
        call = await create_call(
            db, teacher, title=title,
            session_id=session_ids[0] if len(session_ids) == 1 and not class_ids else None,
            class_id=class_ids[0] if len(class_ids) == 1 and not session_ids else None,
        )
        return call.id
    return None


@router.post("/events", status_code=201)
async def create_shared_event(
    body: SharedEventIn,
    actor: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    teacher = _require_teacher(actor)
    resolved = await cal.validate_targets(db, teacher, [(t.target_type, t.target_id) for t in body.targets])
    voice_call_id = await resolve_voice_call(
        db, teacher, voice_call_id=body.voice_call_id, with_voice_call=body.with_voice_call, title=body.title,
        resolved_targets=resolved,
    )
    events = await cal.create_series(
        db, teacher, title=body.title, description=body.description, starts_at=body.starts_at, ends_at=body.ends_at,
        all_day=body.all_day, color=body.color, targets=resolved, recurrence=body.recurrence,
        voice_call_id=voice_call_id,
    )
    await db.commit()
    for event in events:
        await db.refresh(event)
    await broadcast_changed(await rooms_for(db, events[:1]), events[0].id, teacher.id, "created", events[0].title)
    out = await serialize_events(db, events[:1], teacher.id)
    return {**out[0], "occurrences": len(events)}


@router.patch("/events/{event_id}")
async def update_shared_event(
    event_id: uuid.UUID,
    body: SharedEventPatch,
    actor: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
    db: Annotated[AsyncSession, Depends(get_db)],
    scope: Scope = "one",
):
    teacher = _require_teacher(actor)
    event = await owned_event(db, teacher, event_id)
    data = body.model_dump(exclude_unset=True)
    if "recurrence" in data:
        data["recurrence"] = body.recurrence
    if "targets" in data:
        data["targets"] = await cal.validate_targets(db, teacher, [(t.target_type, t.target_id) for t in body.targets or []])
    with_call = data.pop("with_voice_call", False)
    if "voice_call_id" in data or with_call:
        targets_for_call = data.get("targets")
        if targets_for_call is None:
            targets_for_call = [(t.target_type, t.target_id) for t in (await db.execute(
                select(CalendarEventTarget).where(CalendarEventTarget.event_id == event.id))).scalars().all()]
        data["voice_call_id"] = await resolve_voice_call(
            db, teacher, voice_call_id=data.get("voice_call_id"), with_voice_call=with_call,
            title=data.get("title") or event.title, resolved_targets=targets_for_call, current=event.voice_call_id,
        )
    old_rooms = await rooms_for(db, [event])
    rows = await cal.update_event(db, teacher, event, data, scope)
    await db.commit()
    for row in rows:
        await db.refresh(row)
    rooms = old_rooms | await rooms_for(db, rows[:1])
    await broadcast_changed(rooms, rows[0].id, teacher.id, "updated", rows[0].title)
    out = await serialize_events(db, [r for r in rows if r.id == event_id] or rows[:1], teacher.id)
    return {**out[0], "occurrences": len(rows)}


@router.delete("/events/{event_id}", status_code=204)
async def delete_shared_event(
    event_id: uuid.UUID,
    actor: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
    db: Annotated[AsyncSession, Depends(get_db)],
    scope: Scope = "one",
):
    teacher = _require_teacher(actor)
    event = await owned_event(db, teacher, event_id)
    rows = await cal.scoped_events(db, event, scope)
    rooms = await rooms_for(db, [event])
    for row in rows:
        await db.delete(row)
    await db.commit()
    await broadcast_changed(rooms, event_id, teacher.id, "deleted")


@router.post("/agent")
async def calendar_agent_endpoint(
    actor: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
    db: Annotated[AsyncSession, Depends(get_db)],
    prompt: Annotated[str, Form(min_length=1, max_length=20000)],
    conversation_id: Annotated[Optional[uuid.UUID], Form()] = None,
    session_id: Annotated[Optional[uuid.UUID], Form()] = None,
    files: list[UploadFile] = UploadField(default=[]),
):
    """Agentic calendar edits from the teacher chat: create/move/delete events, recurrences, free slots, dates from documents."""
    from app.services.calendar_agent import run_calendar_agent
    return await run_calendar_agent(db, _require_teacher(actor), prompt=prompt, conversation_id=conversation_id,
                                    session_id=session_id, files=files)
