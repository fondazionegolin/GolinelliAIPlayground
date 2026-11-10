"""10-minute reminders for shared calendar events.

Runs only in the gateway process (see main.py lifespan). Each event is claimed atomically by setting
`reminder_sent_at`, so a restart or a second gateway never sends the same reminder twice.
For every reminder:
- a `calendar_reminder` socket event pops up for the owner and the invited co-teachers (personal room)
  and for everyone in the target sessions (students see the popup there);
- a notification message is stored in each target session's class chat and broadcast live.
"""
from __future__ import annotations

import asyncio
import logging
import uuid
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import AsyncSessionLocal
from app.models.calendar import CalendarEvent, CalendarEventTarget
from app.models.chat import ChatMessage, ChatRoom
from app.models.enums import ChatRoomType, SenderType, SessionStatus
from app.models.session import Session

logger = logging.getLogger(__name__)

LEAD = timedelta(minutes=10)
# Events created or moved inside the window still get a reminder; older ones are skipped.
GRACE = timedelta(minutes=2)
POLL_SECONDS = 30
LOCAL_TZ = ZoneInfo("Europe/Rome")


async def event_recipients(db: AsyncSession, event_id: uuid.UUID, owner_id: uuid.UUID) -> tuple[list[str], list[Session]]:
    """(teacher ids, sessions) that see the event. Class targets expand to the class's live sessions."""
    targets = (await db.execute(
        select(CalendarEventTarget).where(CalendarEventTarget.event_id == event_id)
    )).scalars().all()
    teacher_ids = [str(owner_id)] + [str(t.target_id) for t in targets if t.target_type == "teacher"]
    session_ids = {t.target_id for t in targets if t.target_type == "session"}
    class_ids = {t.target_id for t in targets if t.target_type == "class"}
    sessions: list[Session] = []
    if session_ids:
        sessions += (await db.execute(
            select(Session).where(Session.id.in_(session_ids)).where(Session.deleted_at.is_(None))
        )).scalars().all()
    if class_ids:
        sessions += (await db.execute(
            select(Session)
            .where(Session.class_id.in_(class_ids))
            .where(Session.deleted_at.is_(None))
            .where(Session.status != SessionStatus.ENDED)
        )).scalars().all()
    unique = {session.id: session for session in sessions}
    return list(dict.fromkeys(teacher_ids)), list(unique.values())


async def event_rooms(db: AsyncSession, event_id: uuid.UUID, owner_id: uuid.UUID) -> list[str]:
    teacher_ids, sessions = await event_recipients(db, event_id, owner_id)
    return [f"user:{tid}" for tid in teacher_ids] + [f"session:{s.id}" for s in sessions]


async def _public_room(db: AsyncSession, session: Session) -> ChatRoom:
    room = (await db.execute(
        select(ChatRoom)
        .where(ChatRoom.session_id == session.id)
        .where(ChatRoom.room_type == ChatRoomType.PUBLIC)
        .limit(1)
    )).scalar_one_or_none()
    if room is None:
        room = ChatRoom(tenant_id=session.tenant_id, session_id=session.id, room_type=ChatRoomType.PUBLIC)
        db.add(room)
        await db.flush()
    return room


def _reminder_text(event: CalendarEvent) -> str:
    local = event.starts_at.astimezone(LOCAL_TZ)
    return f"⏰ Tra 10 minuti: {event.title} (ore {local:%H:%M})"


async def _send_reminder(db: AsyncSession, event: CalendarEvent) -> None:
    from app.realtime.gateway import sio

    teacher_ids, sessions = await event_recipients(db, event.id, event.owner_teacher_id)
    payload = {
        "event_id": f"calendar-reminder:{event.id}",
        "calendar_event_id": str(event.id),
        "title": event.title,
        "description": event.description,
        "starts_at": event.starts_at.isoformat(),
        "ends_at": event.ends_at.isoformat() if event.ends_at else None,
        "color": event.color,
        "teacher_ids": teacher_ids,
        "voice_call_code": None,
    }
    text = _reminder_text(event)
    if event.voice_call_id:
        from app.models.voice_call import VoiceCall
        call = await db.get(VoiceCall, event.voice_call_id)
        if call and call.link_enabled:
            payload["voice_call_code"] = call.code
            text += f" · 🎥 videochiamata: /call/{call.code}"
    notification_data = {k: payload[k] for k in ("calendar_event_id", "title", "starts_at", "ends_at", "color", "voice_call_code")}

    chat_messages: list[tuple[Session, ChatMessage]] = []
    for session in sessions:
        room = await _public_room(db, session)
        message = ChatMessage(
            tenant_id=session.tenant_id,
            session_id=session.id,
            room_id=room.id,
            sender_type=SenderType.TEACHER,
            sender_teacher_id=event.owner_teacher_id,
            message_text=text,
            attachments={
                "is_notification": True,
                "notification_type": "calendar_reminder",
                "notification_data": notification_data,
            },
        )
        db.add(message)
        chat_messages.append((session, message))
    await db.commit()

    for teacher_id in teacher_ids:
        await sio.emit("calendar_reminder", payload, room=f"user:{teacher_id}")
    for session, message in chat_messages:
        await sio.emit("calendar_reminder", {**payload, "session_id": str(session.id)}, room=f"session:{session.id}")
        await sio.emit(
            "chat_message",
            {
                "room_type": "PUBLIC",
                "session_id": str(session.id),
                "message": {
                    "id": str(message.id),
                    "sender_type": "TEACHER",
                    "sender_id": "system",
                    "sender_name": "Calendario",
                    "text": text,
                    "attachments": [],
                    "created_at": datetime.now(timezone.utc).isoformat(),
                    "is_notification": True,
                    "notification_type": "calendar_reminder",
                    "notification_data": notification_data,
                },
            },
            room=f"session:{session.id}",
        )


async def dispatch_due_reminders(now: datetime | None = None) -> int:
    now = now or datetime.now(timezone.utc)
    async with AsyncSessionLocal() as db:
        claimed = (await db.execute(
            update(CalendarEvent)
            .where(CalendarEvent.reminder_sent_at.is_(None))
            .where(CalendarEvent.all_day.is_(False))
            .where(CalendarEvent.starts_at <= now + LEAD)
            .where(CalendarEvent.starts_at > now - GRACE)
            .values(reminder_sent_at=now)
            .returning(CalendarEvent.id)
        )).scalars().all()
        await db.commit()
        for event_id in claimed:
            event = await db.get(CalendarEvent, event_id)
            if event is None:
                continue
            try:
                await _send_reminder(db, event)
            except Exception:
                logger.exception("calendar reminder failed for %s", event_id)
                await db.rollback()
        return len(claimed)


async def reminder_loop() -> None:
    while True:
        try:
            await dispatch_due_reminders()
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("calendar reminder loop error")
        await asyncio.sleep(POLL_SECONDS)
