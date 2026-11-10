"""Class video calls reachable through invite links (`/call/<code>`).

A call is a LiveKit room of its own (`eduai-call-<id>`) whose live state (speaking floor, raised hands)
lives in the gateway like the per-session voice room, under the key ``call:<id>``.

Who may join (``call_role``):
- the owner, and every teacher who can access the bound session/class or who is invited to (or owns) a
  calendar event linking the call → ``moderator`` (start/stop, give the floor);
- students whose session is the bound one, belongs to the bound class, or is targeted by a linked event
  → ``participant`` (they speak only when given the floor);
- with ``open_to_teachers`` any signed-in teacher holding the link → ``participant``.
A disabled link (``link_enabled = False``) lets in only the owner.
"""
from __future__ import annotations

import re
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from typing import Literal, Optional

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.permissions import teacher_can_access_class, teacher_can_access_session
from app.models.calendar import CalendarEvent, CalendarEventTarget
from app.models.session import Class, Session
from app.models.user import User
from app.models.voice_call import VoiceCall

CallRole = Literal["moderator", "participant"]

# No i, l, o: codes are read aloud and typed by students.
CODE_ALPHABET = "abcdefghjkmnpqrstuvwxyz"
CODE_GROUPS = (3, 4, 3)
_CODE_RE = re.compile(r"^[a-z]{3}-[a-z]{4}-[a-z]{3}$")


def generate_code() -> str:
    return "-".join("".join(secrets.choice(CODE_ALPHABET) for _ in range(n)) for n in CODE_GROUPS)


def normalize_code(raw: str) -> Optional[str]:
    """Accept "KQF MXTA VBE", "kqfmxtavbe" or a full invite URL; return the canonical code or None."""
    text = (raw or "").strip().lower().rstrip("/")
    if "/" in text:
        text = text.rsplit("/", 1)[-1]
    letters = re.sub(r"[^a-z]", "", text)
    if len(letters) != sum(CODE_GROUPS):
        return None
    code = f"{letters[:3]}-{letters[3:7]}-{letters[7:]}"
    return code if _CODE_RE.match(code) else None


async def unique_code(db: AsyncSession) -> str:
    for _ in range(20):
        code = generate_code()
        if not (await db.execute(select(VoiceCall.id).where(VoiceCall.code == code))).first():
            return code
    raise RuntimeError("Could not allocate a unique call code")


def call_key(call_id) -> str:
    return f"call:{call_id}"


def livekit_room(call_id) -> str:
    return f"eduai-call-{call_id}"


async def linked_events_audience(db: AsyncSession, call_id: uuid.UUID) -> tuple[set[uuid.UUID], dict[str, set[uuid.UUID]]]:
    """(owners of linked events, {target_type: ids}) of every calendar event that links the call."""
    events = select(CalendarEvent.id).where(CalendarEvent.voice_call_id == call_id)
    owners = set((await db.execute(
        select(CalendarEvent.owner_teacher_id).where(CalendarEvent.voice_call_id == call_id).distinct()
    )).scalars().all())
    rows = (await db.execute(
        select(CalendarEventTarget.target_type, CalendarEventTarget.target_id)
        .where(CalendarEventTarget.event_id.in_(events)).distinct()
    )).all()
    targets: dict[str, set[uuid.UUID]] = {"class": set(), "session": set(), "teacher": set()}
    for target_type, target_id in rows:
        targets.setdefault(target_type, set()).add(target_id)
    return owners, targets


async def call_role(
    db: AsyncSession,
    call: VoiceCall,
    *,
    teacher: Optional[User] = None,
    student_session_id: Optional[uuid.UUID] = None,
) -> Optional[CallRole]:
    if teacher is not None:
        if call.owner_teacher_id == teacher.id:
            return "moderator"
        if not call.link_enabled:
            return None
        if call.session_id and await teacher_can_access_session(db, teacher, call.session_id):
            return "moderator"
        if call.class_id and await teacher_can_access_class(db, teacher, call.class_id):
            return "moderator"
        owners, targets = await linked_events_audience(db, call.id)
        if teacher.id in owners or teacher.id in targets["teacher"]:
            return "moderator"
        for session_id in targets["session"]:
            if await teacher_can_access_session(db, teacher, session_id):
                return "moderator"
        for class_id in targets["class"]:
            if await teacher_can_access_class(db, teacher, class_id):
                return "moderator"
        return "participant" if call.open_to_teachers else None

    if student_session_id is not None:
        if not call.link_enabled:
            return None
        session = await db.get(Session, student_session_id)
        if not session or session.deleted_at is not None:
            return None
        if call.session_id == session.id or (call.class_id and call.class_id == session.class_id):
            return "participant"
        _, targets = await linked_events_audience(db, call.id)
        if session.id in targets["session"] or session.class_id in targets["class"]:
            return "participant"
    return None


async def next_event(db: AsyncSession, call_id: uuid.UUID, now: Optional[datetime] = None) -> Optional[CalendarEvent]:
    """The linked calendar occurrence happening now or next (an event without end lasts one hour)."""
    now = now or datetime.now(timezone.utc)
    end = func.coalesce(CalendarEvent.ends_at, CalendarEvent.starts_at + timedelta(hours=1))
    return (await db.execute(
        select(CalendarEvent)
        .where(CalendarEvent.voice_call_id == call_id)
        .where(end >= now)
        .order_by(CalendarEvent.starts_at)
        .limit(1)
    )).scalar_one_or_none()


def is_live(call_id) -> bool:
    try:
        from app.realtime.gateway import voice_rooms
        return bool((voice_rooms.get(call_key(call_id)) or {}).get("active"))
    except Exception:  # pragma: no cover - gateway not importable in some tools
        return False


async def serialize_call(
    db: AsyncSession, call: VoiceCall, *, role: Optional[CallRole], viewer_teacher_id: Optional[uuid.UUID],
) -> dict:
    session = await db.get(Session, call.session_id) if call.session_id else None
    cls = await db.get(Class, call.class_id) if call.class_id else None
    owner = await db.get(User, call.owner_teacher_id)
    event = await next_event(db, call.id)
    is_owner = viewer_teacher_id is not None and call.owner_teacher_id == viewer_teacher_id
    return {
        "id": str(call.id),
        "code": call.code,
        "title": call.title,
        "join_path": f"/call/{call.code}",
        "session_id": str(call.session_id) if call.session_id else None,
        "session_label": session.title if session else None,
        "class_id": str(call.class_id) if call.class_id else None,
        "class_label": cls.name if cls else None,
        "owner_teacher_id": str(call.owner_teacher_id),
        "owner_name": (f"{owner.first_name or ''} {owner.last_name or ''}".strip() or "Docente") if owner else "Docente",
        "is_owner": is_owner,
        "role": role,
        # Link settings are management data: only the owner sees them.
        "link_enabled": call.link_enabled if is_owner else None,
        "open_to_teachers": call.open_to_teachers if is_owner else None,
        "live": is_live(call.id),
        "last_started_at": call.last_started_at.isoformat() if call.last_started_at else None,
        "next_event": {
            "id": str(event.id),
            "title": event.title,
            "starts_at": event.starts_at.isoformat(),
            "ends_at": event.ends_at.isoformat() if event.ends_at else None,
        } if event else None,
        "created_at": call.created_at.isoformat() if call.created_at else None,
    }


def calls_for_session(session: Session):
    """Calls whose audience includes every student of `session` (bound, class-wide or via events)."""
    targeted = select(CalendarEvent.voice_call_id).join(
        CalendarEventTarget, CalendarEventTarget.event_id == CalendarEvent.id,
    ).where(CalendarEvent.voice_call_id.is_not(None)).where(or_(
        (CalendarEventTarget.target_type == "session") & (CalendarEventTarget.target_id == session.id),
        (CalendarEventTarget.target_type == "class") & (CalendarEventTarget.target_id == session.class_id),
    ))
    return or_(
        VoiceCall.session_id == session.id,
        VoiceCall.class_id == session.class_id,
        VoiceCall.id.in_(targeted),
    )
