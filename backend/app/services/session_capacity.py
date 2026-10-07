"""Session capacity: the limit applies to students connected *at the same time*, not to everyone who ever joined.

A student counts as connected when they hold a live socket (realtime gateway presence) or sent a heartbeat/joined in
the last ``ONLINE_WINDOW`` (the web client pings every 30 s, so a few minutes of silence means they left).
"""
from datetime import datetime, timedelta, timezone
from typing import Optional
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.session import SessionStudent
from app.realtime.gateway import get_online_student_ids

ONLINE_WINDOW = timedelta(minutes=5)


def online_cutoff() -> datetime:
    return datetime.now(timezone.utc) - ONLINE_WINDOW


async def online_student_ids(db: AsyncSession, session_id: UUID) -> set[str]:
    rows = (await db.execute(
        select(SessionStudent.id).where(SessionStudent.session_id == session_id, SessionStudent.last_seen_at >= online_cutoff())
    )).scalars().all()
    return {str(row) for row in rows} | set(get_online_student_ids(str(session_id)))


async def concurrent_students(db: AsyncSession, session_id: UUID, exclude_student_id: Optional[UUID] = None) -> int:
    ids = await online_student_ids(db, session_id)
    if exclude_student_id:
        ids.discard(str(exclude_student_id))
    return len(ids)


def full_message(connected: int, limit: int) -> str:
    return f"Sessione piena: ci sono già {connected} studenti connessi contemporaneamente (massimo {limit}). Riprova tra poco."
