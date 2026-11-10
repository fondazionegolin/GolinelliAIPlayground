"""Class video calls with invite links (`/call/<code>`): create, resolve, manage the link, LiveKit token.

Domain rules (audience, roles, codes) live in services/voice_calls.py. Calls are scheduled by linking them
to calendar events (endpoints/calendar.py, `voice_call_id` / `with_voice_call`).
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from typing import Annotated, Optional

import jwt
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import StudentOrTeacher, get_db, get_student_or_teacher
from app.api.v1.endpoints.voice import build_ice_servers
from app.core.config import settings
from app.core.permissions import teacher_can_access_class, teacher_can_access_session
from app.models.calendar import CalendarEvent, CalendarEventTarget
from app.models.session import Session
from app.models.user import User
from app.models.voice_call import VoiceCall
from app.services import voice_calls as vc

router = APIRouter(prefix="/voice-calls")


class VoiceCallIn(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    session_id: Optional[uuid.UUID] = None
    class_id: Optional[uuid.UUID] = None
    open_to_teachers: bool = False


class VoiceCallPatch(BaseModel):
    title: Optional[str] = Field(default=None, min_length=1, max_length=200)
    link_enabled: Optional[bool] = None
    open_to_teachers: Optional[bool] = None


def _teacher(actor: StudentOrTeacher) -> User:
    if not actor.is_teacher:
        raise HTTPException(status_code=403, detail="Solo i docenti possono gestire le videochiamate")
    return actor.teacher


async def _role(db: AsyncSession, call: VoiceCall, actor: StudentOrTeacher):
    if actor.is_teacher:
        return await vc.call_role(db, call, teacher=actor.teacher)
    return await vc.call_role(db, call, student_session_id=actor.student.session_id)


async def _owned(db: AsyncSession, teacher: User, call_id: uuid.UUID) -> VoiceCall:
    call = await db.get(VoiceCall, call_id)
    if not call:
        raise HTTPException(status_code=404, detail="Videochiamata non trovata")
    if call.owner_teacher_id != teacher.id:
        raise HTTPException(status_code=403, detail="Solo chi ha creato la videochiamata può modificarla")
    return call


async def _validate_audience(db: AsyncSession, teacher: User, session_id, class_id) -> tuple:
    if session_id:
        if not await teacher_can_access_session(db, teacher, session_id):
            raise HTTPException(status_code=403, detail="Sessione non accessibile")
        session = await db.get(Session, session_id)
        class_id = None if session and class_id == session.class_id else class_id
    if class_id and not await teacher_can_access_class(db, teacher, class_id):
        raise HTTPException(status_code=403, detail="Classe non accessibile")
    return session_id, class_id


async def create_call(
    db: AsyncSession, teacher: User, *, title: str, session_id=None, class_id=None, open_to_teachers: bool = False,
) -> VoiceCall:
    """Create a call (audience must already be validated). Shared with the calendar endpoints."""
    call = VoiceCall(
        tenant_id=teacher.tenant_id, owner_teacher_id=teacher.id, title=title.strip()[:200] or "Videochiamata",
        code=await vc.unique_code(db), session_id=session_id, class_id=class_id, open_to_teachers=open_to_teachers,
    )
    db.add(call)
    await db.flush()
    return call


@router.get("")
async def list_calls(
    actor: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
    db: Annotated[AsyncSession, Depends(get_db)],
    session_id: Optional[uuid.UUID] = None,
):
    """Calls of a session (sidebar; a student always gets their own session's) or, for a teacher without
    `session_id`, the calls they own or are invited to through a calendar event."""
    if actor.is_student:
        session_id = actor.student.session_id
    viewer_id = actor.teacher.id if actor.is_teacher else None
    if session_id:
        if actor.is_teacher and not await teacher_can_access_session(db, actor.teacher, session_id):
            raise HTTPException(status_code=403, detail="Sessione non accessibile")
        session = await db.get(Session, session_id)
        if not session:
            raise HTTPException(status_code=404, detail="Sessione non trovata")
        clause = vc.calls_for_session(session)
        if actor.is_student:
            clause = clause & VoiceCall.link_enabled.is_(True)
    else:
        teacher = _teacher(actor)
        invited = select(CalendarEvent.voice_call_id).join(
            CalendarEventTarget, CalendarEventTarget.event_id == CalendarEvent.id,
        ).where(CalendarEventTarget.target_type == "teacher", CalendarEventTarget.target_id == teacher.id)
        clause = or_(VoiceCall.owner_teacher_id == teacher.id, VoiceCall.id.in_(invited))
    calls = (await db.execute(
        select(VoiceCall).where(clause).order_by(VoiceCall.created_at.desc()).limit(60)
    )).scalars().all()
    out = []
    for call in calls:
        role = await _role(db, call, actor)
        if role:
            out.append(await vc.serialize_call(db, call, role=role, viewer_teacher_id=viewer_id))
    # Live first, then the closest scheduled occurrence, then the most recent.
    out.sort(key=lambda c: (not c["live"], c["next_event"]["starts_at"] if c["next_event"] else "9999", ))
    return out


@router.post("", status_code=201)
async def create_call_endpoint(
    body: VoiceCallIn,
    actor: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    teacher = _teacher(actor)
    session_id, class_id = await _validate_audience(db, teacher, body.session_id, body.class_id)
    call = await create_call(db, teacher, title=body.title, session_id=session_id, class_id=class_id,
                             open_to_teachers=body.open_to_teachers)
    await db.commit()
    await db.refresh(call)
    return await vc.serialize_call(db, call, role="moderator", viewer_teacher_id=teacher.id)


@router.get("/by-code/{code}")
async def resolve_call(
    code: str,
    actor: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    normalized = vc.normalize_code(code)
    call = (await db.execute(select(VoiceCall).where(VoiceCall.code == normalized))).scalar_one_or_none() if normalized else None
    if not call:
        raise HTTPException(status_code=404, detail="Codice videochiamata non valido o scaduto")
    role = await _role(db, call, actor)
    if not role:
        detail = "Il link di invito è stato disattivato" if not call.link_enabled else "Non fai parte degli invitati a questa videochiamata"
        raise HTTPException(status_code=403, detail=detail)
    return await vc.serialize_call(db, call, role=role, viewer_teacher_id=actor.teacher.id if actor.is_teacher else None)


@router.patch("/{call_id}")
async def update_call(
    call_id: uuid.UUID,
    body: VoiceCallPatch,
    actor: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    teacher = _teacher(actor)
    call = await _owned(db, teacher, call_id)
    for field, value in body.model_dump(exclude_unset=True).items():
        if value is not None:
            setattr(call, field, value.strip() if isinstance(value, str) else value)
    await db.commit()
    await db.refresh(call)
    if not call.link_enabled:
        await _kick_non_owners(call)
    return await vc.serialize_call(db, call, role="moderator", viewer_teacher_id=teacher.id)


@router.post("/{call_id}/regenerate-code")
async def regenerate_code(
    call_id: uuid.UUID,
    actor: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """New code: every invite link shared so far stops working (calendar events follow automatically)."""
    teacher = _teacher(actor)
    call = await _owned(db, teacher, call_id)
    call.code = await vc.unique_code(db)
    await db.commit()
    await db.refresh(call)
    return await vc.serialize_call(db, call, role="moderator", viewer_teacher_id=teacher.id)


@router.delete("/{call_id}", status_code=204)
async def delete_call(
    call_id: uuid.UUID,
    actor: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    teacher = _teacher(actor)
    call = await _owned(db, teacher, call_id)
    await _kick_non_owners(call, everyone=True)
    await db.delete(call)
    await db.commit()


async def _kick_non_owners(call: VoiceCall, everyone: bool = False) -> None:
    """Close the live room when the link is disabled or the call deleted (best effort)."""
    try:
        from app.realtime.gateway import end_voice_call
        await end_voice_call(str(call.id), reason="deleted" if everyone else "link_disabled")
    except Exception as exc:  # pragma: no cover - realtime is optional
        print(f"[voice-calls] could not close room {call.id}: {exc}")


@router.post("/{call_id}/token")
async def call_token(
    call_id: uuid.UUID,
    actor: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    if not settings.LIVEKIT_URL or not settings.LIVEKIT_API_KEY or not settings.LIVEKIT_API_SECRET:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Realtime media chat is not configured")
    call = await db.get(VoiceCall, call_id)
    if not call:
        raise HTTPException(status_code=404, detail="Videochiamata non trovata")
    role = await _role(db, call, actor)
    if not role:
        raise HTTPException(status_code=403, detail="Accesso alla videochiamata negato")

    now = datetime.now(timezone.utc)
    expires_at = now + timedelta(minutes=settings.LIVEKIT_TOKEN_TTL_MINUTES)
    if actor.is_student:
        from app.realtime.gateway import voice_rooms
        identity = f"student:{actor.student.id}"
        name = actor.student.nickname or "Studente"
        state = voice_rooms.get(vc.call_key(call.id)) or {}
        can_publish = str(actor.student.id) in (state.get("active_speaker_ids") or [])
    else:
        identity = f"teacher:{actor.teacher.id}"
        name = f"{actor.teacher.first_name or ''} {actor.teacher.last_name or ''}".strip() or "Docente"
        can_publish = True

    room = vc.livekit_room(call.id)
    token = jwt.encode({
        "iss": settings.LIVEKIT_API_KEY,
        "sub": identity,
        "name": name,
        "nbf": int(now.timestamp()),
        "exp": int(expires_at.timestamp()),
        "video": {"room": room, "roomJoin": True, "canSubscribe": True, "canPublish": can_publish, "canPublishData": True},
    }, settings.LIVEKIT_API_SECRET, algorithm="HS256")
    return {
        "url": settings.LIVEKIT_URL,
        "token": token,
        "room": room,
        "identity": identity,
        "can_publish": can_publish,
        "expires_at": expires_at.isoformat(),
        "ice_servers": build_ice_servers(),
    }
