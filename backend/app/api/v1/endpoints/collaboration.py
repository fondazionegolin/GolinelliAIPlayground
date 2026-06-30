"""Collaborative ("Condividi con") shared chat.

A student opens a shared room with selected peers in the same session and a target
bot (a teacherbot or a predefined assistant profile). Every message triggers a bot
reply broadcast to all participants — except a message addressed to a participant with
a leading ``@nickname``, which stays peer-to-peer and does not call the LLM.

Realtime delivery reuses the gateway's per-student personal rooms (``student:{id}``),
which each student's socket already joins on connect, so no extra socket handshake is
needed: endpoints persist + emit, clients listen for ``share_chat_message`` /
``share_chat_invite``.
"""
from typing import Annotated, Optional
from uuid import UUID
import logging

from fastapi import APIRouter, Depends, HTTPException, status, Request
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.api.deps import get_current_student
from app.models.session import Session, SessionStudent, Class, SessionModule
from app.models.teacherbot import Teacherbot, TeacherbotStatus, TeacherbotPublication
from app.models.shared_chat import SharedChatRoom, SharedChatParticipant, SharedChatMessage
from app.services.llm_service import llm_service
from app.services.credit_service import credit_service
from app.services.chatbot_profiles import get_profile
from app.services.education_level import get_school_grade_instruction
from app.services.ui_language import apply_output_language_instruction, resolve_ui_language
from app.services.environmental_impact import enrich_usage_with_environmental_impact
from app.realtime.gateway import sio

logger = logging.getLogger(__name__)
router = APIRouter()

TEACHER_PREVIEW_NICKNAME = "[Anteprima Docente]"


# ==================== Schemas ====================

class SeedMessage(BaseModel):
    role: str  # 'user' | 'assistant'
    content: str
    sender_nickname: Optional[str] = None


class CreateRoomRequest(BaseModel):
    kind: str  # 'teacherbot' | 'assistant'
    teacherbot_id: Optional[UUID] = None
    profile_key: Optional[str] = None
    participant_ids: list[UUID] = []
    title: Optional[str] = None
    seed_messages: list[SeedMessage] = []  # existing conversation history to share


class SendMessageRequest(BaseModel):
    content: str


# ==================== Helpers ====================

def _ui_language(request: Optional[Request]) -> str:
    if request is None:
        return "it"
    return resolve_ui_language(
        request.headers.get("x-app-language") or request.headers.get("accept-language")
    )


async def _require_collab_enabled(db: AsyncSession, session_id: UUID) -> None:
    result = await db.execute(
        select(SessionModule.is_enabled)
        .where(SessionModule.session_id == session_id)
        .where(SessionModule.module_key == "chat_collaboration")
        .limit(1)
    )
    enabled = result.scalar_one_or_none()
    if not enabled:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="La collaborazione chat non è abilitata in questa sessione",
        )


def _serialize_message(m: SharedChatMessage) -> dict:
    return {
        "id": str(m.id),
        "room_id": str(m.room_id),
        "role": m.role,
        "sender_student_id": str(m.sender_student_id) if m.sender_student_id else None,
        "sender_nickname": m.sender_nickname,
        "content": m.content,
        "is_peer": m.is_peer,
        "created_at": m.created_at.isoformat() if m.created_at else None,
    }


async def _room_participants(db: AsyncSession, room_id: UUID) -> list[SessionStudent]:
    result = await db.execute(
        select(SessionStudent)
        .join(SharedChatParticipant, SharedChatParticipant.student_id == SessionStudent.id)
        .where(SharedChatParticipant.room_id == room_id)
        .order_by(SessionStudent.nickname)
    )
    return list(result.scalars().all())


def _room_summary(room: SharedChatRoom, participants: list[SessionStudent]) -> dict:
    return {
        "id": str(room.id),
        "kind": room.kind,
        "teacherbot_id": str(room.teacherbot_id) if room.teacherbot_id else None,
        "profile_key": room.profile_key,
        "title": room.title,
        "owner_student_id": str(room.owner_student_id),
        "is_active": room.is_active,
        "created_at": room.created_at.isoformat() if room.created_at else None,
        "participants": [
            {"id": str(s.id), "nickname": s.nickname, "avatar_url": s.avatar_url}
            for s in participants
        ],
    }


async def _broadcast(participant_ids: list[UUID], event: str, payload: dict) -> None:
    for pid in participant_ids:
        try:
            await sio.emit(event, payload, room=f"student:{pid}")
        except Exception as exc:  # never let a socket hiccup break the request
            logger.warning("share-chat emit failed for %s: %s", pid, exc)


def _detect_peer_mention(content: str, nicknames: list[str]) -> Optional[str]:
    """Return the mentioned nickname if the message opens with @nickname of a participant."""
    stripped = content.strip()
    if not stripped.startswith("@"):
        return None
    after = stripped[1:].lower()
    # Longest nickname first so "Anna Rossi" wins over "Anna".
    for nick in sorted(nicknames, key=len, reverse=True):
        n = nick.lower()
        if after == n or after.startswith(n + " ") or after.startswith(n + ":") or after.startswith(n + ","):
            return nick
    return None


async def _get_room_for_participant(db: AsyncSession, room_id: UUID, student: SessionStudent) -> SharedChatRoom:
    result = await db.execute(select(SharedChatRoom).where(SharedChatRoom.id == room_id))
    room = result.scalar_one_or_none()
    if not room or not room.is_active:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Chat condivisa non trovata")
    member = await db.execute(
        select(SharedChatParticipant)
        .where(SharedChatParticipant.room_id == room_id)
        .where(SharedChatParticipant.student_id == student.id)
    )
    if not member.scalar_one_or_none():
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Non fai parte di questa chat")
    return room


# ==================== Endpoints ====================

@router.get("/collaboration/participants")
async def list_session_participants(
    db: Annotated[AsyncSession, Depends(get_db)],
    student: Annotated[SessionStudent, Depends(get_current_student)],
):
    """Registered students currently in the session, available to share a chat with."""
    result = await db.execute(
        select(SessionStudent)
        .where(SessionStudent.session_id == student.session_id)
        .where(SessionStudent.id != student.id)
        .order_by(SessionStudent.nickname)
    )
    return [
        {"id": str(s.id), "nickname": s.nickname, "avatar_url": s.avatar_url}
        for s in result.scalars().all()
        if s.nickname != TEACHER_PREVIEW_NICKNAME
    ]


@router.post("/collaboration/rooms")
async def create_room(
    request: CreateRoomRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    student: Annotated[SessionStudent, Depends(get_current_student)],
):
    await _require_collab_enabled(db, student.session_id)

    if request.kind not in ("teacherbot", "assistant"):
        raise HTTPException(status_code=400, detail="Tipo di chat non valido")

    title = request.title
    if request.kind == "teacherbot":
        if not request.teacherbot_id:
            raise HTTPException(status_code=400, detail="teacherbot_id richiesto")
        session_result = await db.execute(select(Session).where(Session.id == student.session_id))
        session = session_result.scalar_one()
        bot_result = await db.execute(
            select(Teacherbot)
            .join(TeacherbotPublication, TeacherbotPublication.teacherbot_id == Teacherbot.id)
            .where(Teacherbot.id == request.teacherbot_id)
            .where(TeacherbotPublication.class_id == session.class_id)
            .where(TeacherbotPublication.is_active == True)
            .where(Teacherbot.status == TeacherbotStatus.PUBLISHED)
        )
        bot = bot_result.scalar_one_or_none()
        if not bot:
            raise HTTPException(status_code=404, detail="Assistente non disponibile")
        title = title or bot.name
    else:
        if not request.profile_key or not get_profile(request.profile_key):
            raise HTTPException(status_code=400, detail="profile_key non valido")
        title = title or request.profile_key

    room = SharedChatRoom(
        tenant_id=student.tenant_id,
        session_id=student.session_id,
        owner_student_id=student.id,
        kind=request.kind,
        teacherbot_id=request.teacherbot_id if request.kind == "teacherbot" else None,
        profile_key=request.profile_key if request.kind == "assistant" else None,
        title=title,
    )
    db.add(room)
    await db.flush()

    # Owner + the chosen peers (only those actually in this session).
    member_ids = {student.id}
    if request.participant_ids:
        valid = await db.execute(
            select(SessionStudent.id)
            .where(SessionStudent.session_id == student.session_id)
            .where(SessionStudent.id.in_(request.participant_ids))
        )
        member_ids.update(valid.scalars().all())

    for mid in member_ids:
        db.add(SharedChatParticipant(room_id=room.id, student_id=mid))

    # Seed the room with the owner's existing conversation so invited peers see the history.
    for seed in (request.seed_messages or [])[:200]:
        content = (seed.content or "").strip()
        if not content:
            continue
        is_assistant = seed.role == "assistant"
        db.add(SharedChatMessage(
            room_id=room.id,
            sender_student_id=None if is_assistant else student.id,
            role="assistant" if is_assistant else "user",
            sender_nickname=(title if is_assistant else (seed.sender_nickname or student.nickname)),
            content=content,
        ))

    await db.commit()
    await db.refresh(room)

    participants = await _room_participants(db, room.id)
    summary = _room_summary(room, participants)

    # Notify the invited peers (everyone except the owner).
    invited = [s.id for s in participants if s.id != student.id]
    await _broadcast(invited, "share_chat_invite", {
        "room": summary,
        "invited_by": student.nickname,
    })

    return summary


@router.get("/collaboration/rooms")
async def list_my_rooms(
    db: Annotated[AsyncSession, Depends(get_db)],
    student: Annotated[SessionStudent, Depends(get_current_student)],
):
    result = await db.execute(
        select(SharedChatRoom)
        .join(SharedChatParticipant, SharedChatParticipant.room_id == SharedChatRoom.id)
        .where(SharedChatParticipant.student_id == student.id)
        .where(SharedChatRoom.is_active == True)
        .order_by(SharedChatRoom.created_at.desc())
    )
    rooms = result.scalars().all()
    out = []
    for room in rooms:
        participants = await _room_participants(db, room.id)
        out.append(_room_summary(room, participants))
    return out


@router.get("/collaboration/rooms/{room_id}")
async def get_room(
    room_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    student: Annotated[SessionStudent, Depends(get_current_student)],
):
    room = await _get_room_for_participant(db, room_id, student)
    participants = await _room_participants(db, room.id)
    msgs_result = await db.execute(
        select(SharedChatMessage)
        .where(SharedChatMessage.room_id == room.id)
        .order_by(SharedChatMessage.created_at.asc())
    )
    summary = _room_summary(room, participants)
    summary["messages"] = [_serialize_message(m) for m in msgs_result.scalars().all()]
    return summary


@router.post("/collaboration/rooms/{room_id}/messages")
async def send_room_message(
    room_id: UUID,
    request: SendMessageRequest,
    http_request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
    student: Annotated[SessionStudent, Depends(get_current_student)],
):
    content = (request.content or "").strip()
    if not content:
        raise HTTPException(status_code=400, detail="Messaggio vuoto")

    room = await _get_room_for_participant(db, room_id, student)
    participants = await _room_participants(db, room.id)
    participant_ids = [s.id for s in participants]
    nicknames = [s.nickname for s in participants]

    is_peer = _detect_peer_mention(content, nicknames) is not None

    user_msg = SharedChatMessage(
        room_id=room.id,
        sender_student_id=student.id,
        role="user",
        sender_nickname=student.nickname,
        content=content,
        is_peer=is_peer,
    )
    db.add(user_msg)
    await db.commit()
    await db.refresh(user_msg)

    await _broadcast(participant_ids, "share_chat_message", {
        "room_id": str(room.id),
        "message": _serialize_message(user_msg),
    })

    if is_peer:
        return {"ok": True, "bot_replied": False}

    # ── Build the bot reply ─────────────────────────────────────────────────
    session_result = await db.execute(
        select(Session, Class).join(Class, Session.class_id == Class.id).where(Session.id == room.session_id)
    )
    session_obj, class_obj = session_result.first()

    allowed = await credit_service.check_availability(
        db, student.tenant_id, estimated_cost=0.0001,
        teacher_id=class_obj.teacher_id, class_id=class_obj.id,
        session_id=session_obj.id, student_id=student.id,
    )
    if not allowed:
        raise HTTPException(status_code=status.HTTP_402_PAYMENT_REQUIRED, detail="Credito esaurito per questa sessione")

    provider = model = None
    if room.kind == "teacherbot":
        bot_result = await db.execute(select(Teacherbot).where(Teacherbot.id == room.teacherbot_id))
        bot = bot_result.scalar_one_or_none()
        if not bot:
            raise HTTPException(status_code=404, detail="Assistente non trovato")
        base_prompt = bot.system_prompt
        provider, model = bot.llm_provider, bot.llm_model
        temperature = bot.temperature
    else:
        profile = get_profile(room.profile_key) or {}
        base_prompt = profile.get("system_prompt", "")
        temperature = 0.7

    grade_instruction = get_school_grade_instruction(class_obj.school_grade)
    names = ", ".join(nicknames)
    is_english = (_ui_language(http_request) or "it").startswith("en")
    collab_note = (
        f"\n\nGROUP CHAT: You are talking with multiple students at once ({names}). "
        "Each student message is prefixed with the speaker's name in square brackets. "
        "Answer the whole group clearly, and address a specific student by name when it helps."
        if is_english else
        f"\n\nCHAT DI GRUPPO: stai parlando con più studenti contemporaneamente ({names}). "
        "Ogni messaggio degli studenti è preceduto dal nome di chi parla tra parentesi quadre. "
        "Rispondi al gruppo in modo chiaro e, quando utile, rivolgiti a uno studente specifico per nome."
    )
    system_prompt = apply_output_language_instruction(
        f"{base_prompt}{grade_instruction}{collab_note}", _ui_language(http_request)
    )

    # History: skip peer-only side messages so the bot only sees what's addressed to it.
    history_result = await db.execute(
        select(SharedChatMessage)
        .where(SharedChatMessage.room_id == room.id)
        .where(SharedChatMessage.is_peer == False)
        .order_by(SharedChatMessage.created_at.asc())
    )
    messages = []
    for m in history_result.scalars().all():
        if m.role == "assistant":
            messages.append({"role": "assistant", "content": m.content})
        else:
            messages.append({"role": "user", "content": f"[{m.sender_nickname}] {m.content}"})

    try:
        llm_response = await llm_service.generate(
            messages=messages,
            system_prompt=system_prompt,
            provider=provider,
            model=model,
            temperature=temperature,
        )
    except Exception as exc:
        logger.error("Shared-chat LLM generation failed: %s", exc)
        raise HTTPException(status_code=502, detail="Errore nella generazione della risposta")

    cost = credit_service.calculate_cost_for_model(
        llm_response.provider, llm_response.model, llm_response.prompt_tokens, llm_response.completion_tokens
    )
    await credit_service.track_usage(
        db, student.tenant_id, llm_response.provider, llm_response.model, cost,
        enrich_usage_with_environmental_impact(
            {
                "type": "shared_chat",
                "room_id": str(room.id),
                "prompt_tokens": llm_response.prompt_tokens,
                "completion_tokens": llm_response.completion_tokens,
            },
            provider=llm_response.provider, model=llm_response.model,
        ),
        teacher_id=class_obj.teacher_id, class_id=class_obj.id, session_id=session_obj.id, student_id=student.id,
    )

    bot_msg = SharedChatMessage(
        room_id=room.id,
        sender_student_id=None,
        role="assistant",
        sender_nickname=room.title,
        content=llm_response.content,
    )
    db.add(bot_msg)
    await db.commit()
    await db.refresh(bot_msg)

    await _broadcast(participant_ids, "share_chat_message", {
        "room_id": str(room.id),
        "message": _serialize_message(bot_msg),
    })

    return {"ok": True, "bot_replied": True}


@router.post("/collaboration/rooms/{room_id}/close")
async def close_room(
    room_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    student: Annotated[SessionStudent, Depends(get_current_student)],
):
    room = await _get_room_for_participant(db, room_id, student)
    if room.owner_student_id != student.id:
        raise HTTPException(status_code=403, detail="Solo chi ha creato la chat può chiuderla")
    room.is_active = False
    participants = await _room_participants(db, room.id)
    await db.commit()
    await _broadcast([s.id for s in participants], "share_chat_closed", {"room_id": str(room.id)})
    return {"ok": True}
