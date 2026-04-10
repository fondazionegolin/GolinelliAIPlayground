from datetime import date, time
from typing import Annotated, Optional
import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select, nullslast
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_db, get_student_or_teacher, StudentOrTeacher
from app.models.calendar import SessionCalendarEvent
from app.models.session import Session

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
