from datetime import datetime, timezone
from typing import Annotated, Optional
import uuid

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import StudentOrTeacher, get_student_or_teacher
from app.core.database import get_db
from app.models.background_job import BackgroundJob
from app.services import background_jobs

router = APIRouter()


def _owner_filter(actor: StudentOrTeacher):
    if actor.is_student:
        return BackgroundJob.owner_student_id == actor.student.id
    return BackgroundJob.owner_user_id == actor.teacher.id


async def _get_owned(db: AsyncSession, job_id: str, actor: StudentOrTeacher) -> BackgroundJob:
    try:
        parsed = uuid.UUID(job_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="Job non trovato")
    job = (await db.execute(select(BackgroundJob).where(BackgroundJob.id == parsed, _owner_filter(actor)))).scalar_one_or_none()
    if not job:
        raise HTTPException(status_code=404, detail="Job non trovato")
    return job


@router.get("")
async def list_jobs(
    db: Annotated[AsyncSession, Depends(get_db)],
    actor: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
    kind: Optional[str] = None,
    resource_id: Optional[str] = None,
    active: bool = False,
):
    """Running jobs plus recently finished ones not yet dismissed (navbar indicator)."""
    recent_since = datetime.now(timezone.utc) - background_jobs.RECENT_WINDOW
    query = select(BackgroundJob).where(_owner_filter(actor))
    if active:
        query = query.where(BackgroundJob.status == "running")
    elif kind:
        # A page asking for its own jobs (e.g. to recover a result) also gets ones already dismissed.
        query = query.where(or_(BackgroundJob.status == "running", BackgroundJob.finished_at >= recent_since))
    else:
        query = query.where(or_(
            BackgroundJob.status == "running",
            (BackgroundJob.finished_at >= recent_since) & BackgroundJob.seen_at.is_(None),
        ))
    if kind:
        query = query.where(BackgroundJob.kind == kind)
    if resource_id:
        query = query.where(BackgroundJob.resource_id == resource_id)
    jobs = (await db.execute(query.order_by(BackgroundJob.created_at.desc()).limit(20))).scalars().all()
    return [background_jobs.serialize(job) for job in jobs]


@router.get("/{job_id}")
async def get_job(
    job_id: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    actor: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
):
    return background_jobs.serialize(await _get_owned(db, job_id, actor))


@router.get("/{job_id}/stream")
async def follow_job(
    job_id: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    actor: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
    start: int = 0,
):
    """Replay the job's event stream from the beginning (same format as the original endpoint)."""
    job = await _get_owned(db, job_id, actor)
    if not background_jobs.is_live(job.id):
        raise HTTPException(status_code=410, detail="Lo stream di questo job non è più disponibile")
    runtime = background_jobs._RUNTIMES[job.id]
    media_type = "text/event-stream" if runtime.event_format == "sse" else "application/x-ndjson"
    return background_jobs.stream_response(job.id, media_type, start)


@router.post("/{job_id}/cancel")
async def cancel_job(
    job_id: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    actor: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
):
    job = await _get_owned(db, job_id, actor)
    return {"cancelled": await background_jobs.cancel(job.id)}


class SeenBody(BaseModel):
    ids: list[str]


@router.post("/seen")
async def mark_seen(
    body: SeenBody,
    db: Annotated[AsyncSession, Depends(get_db)],
    actor: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
):
    ids = []
    for value in body.ids[:50]:
        try:
            ids.append(uuid.UUID(value))
        except ValueError:
            continue
    if ids:
        await db.execute(
            update(BackgroundJob)
            .where(BackgroundJob.id.in_(ids), _owner_filter(actor), BackgroundJob.status != "running")
            .values(seen_at=datetime.now(timezone.utc))
        )
        await db.commit()
    return {"ok": True}
