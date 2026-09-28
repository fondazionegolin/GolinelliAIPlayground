"""Long AI generations that keep running when the user changes page or reloads.

A job wraps the async generator that used to feed a streaming HTTP response. The generator now runs
in its own asyncio task, detached from the request: every chunk it yields is kept in memory so any
number of listeners (the original request, or a page that reconnects after a reload) can replay the
stream from the start and then follow it live. The durable state (status, progress, description)
lives in the `background_jobs` table for the navbar indicator.

The API runs as a single uvicorn process (like the socket gateway), so an in-process registry is
enough; jobs still running when the process stops are marked `interrupted` at the next startup.
"""
from __future__ import annotations

import asyncio
import json
import logging
import math
import time
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any, AsyncIterator, Awaitable, Callable, Optional

from fastapi.responses import StreamingResponse
from sqlalchemy import select, update

from app.core.database import AsyncSessionLocal
from app.models.background_job import BackgroundJob

logger = logging.getLogger(__name__)

EVENT_RETENTION_SECONDS = 30 * 60  # keep the replay log this long after a job ends
PROGRESS_WRITE_INTERVAL = 1.5
ACTIVE_STATUSES = ("running",)
RECENT_WINDOW = timedelta(minutes=30)


@dataclass
class JobOwner:
    tenant_id: uuid.UUID
    user_id: Optional[uuid.UUID] = None
    student_id: Optional[uuid.UUID] = None

    @classmethod
    def from_actor(cls, actor) -> "JobOwner":
        if actor.is_student:
            return cls(tenant_id=actor.student.tenant_id, student_id=actor.student.id)
        return cls(tenant_id=actor.teacher.tenant_id, user_id=actor.teacher.id)


@dataclass
class ProgressState:
    """Mutable state a progress function updates while it watches the job's events."""
    progress: Optional[float] = None
    label: Optional[str] = None
    error: Optional[str] = None
    result: Optional[dict] = None
    data: dict = field(default_factory=dict)


ProgressFn = Callable[[dict, ProgressState], None]
# Called when a stream job ends: (status, state, someone_still_listening). Lets an endpoint persist
# the result server-side when the user already left the page (nobody left to save it client-side).
FinishFn = Callable[[str, ProgressState, bool], Awaitable[None]]


@dataclass
class _Runtime:
    job_id: uuid.UUID
    event_format: str  # "sse" | "ndjson"
    chunks: list[str] = field(default_factory=list)
    done: bool = False
    listeners: int = 0  # open HTTP streams following the job right now
    task: Optional[asyncio.Task] = None
    condition: asyncio.Condition = field(default_factory=asyncio.Condition)


_RUNTIMES: dict[uuid.UUID, _Runtime] = {}


def _error_chunk(event_format: str, message: str) -> str:
    payload = json.dumps({"type": "error", "message": message})
    return f"data: {payload}\n\n" if event_format == "sse" else f"{payload}\n"


def _parse_events(buffer: str, event_format: str) -> tuple[list[dict], str]:
    events: list[dict] = []
    separator = "\n\n" if event_format == "sse" else "\n"
    while separator in buffer:
        frame, buffer = buffer.split(separator, 1)
        lines = frame.split("\n") if event_format == "sse" else [frame]
        for line in lines:
            text = line[6:] if event_format == "sse" and line.startswith("data: ") else line
            if event_format == "sse" and not line.startswith("data: "):
                continue
            try:
                parsed = json.loads(text)
            except (ValueError, TypeError):
                continue
            if isinstance(parsed, dict):
                events.append(parsed)
    return events, buffer


async def _update_job(job_id: uuid.UUID, **values) -> None:
    try:
        async with AsyncSessionLocal() as db:
            await db.execute(update(BackgroundJob).where(BackgroundJob.id == job_id).values(**values))
            await db.commit()
    except Exception:
        logger.exception("background job %s: state update failed", job_id)


async def _create_job(owner: JobOwner, *, kind: str, title: str, description: Optional[str], route: Optional[str],
                      resource_id: Optional[str], expected_seconds: Optional[float]) -> uuid.UUID:
    job_id = uuid.uuid4()
    async with AsyncSessionLocal() as db:
        db.add(BackgroundJob(
            id=job_id,
            tenant_id=owner.tenant_id,
            owner_user_id=owner.user_id,
            owner_student_id=owner.student_id,
            kind=kind,
            title=title[:200],
            description=(description or "")[:4000] or None,
            route=(route or "")[:300] or None,
            resource_id=str(resource_id)[:64] if resource_id else None,
            status="running",
            expected_seconds=expected_seconds,
        ))
        await db.commit()
    return job_id


async def _notify(runtime: _Runtime) -> None:
    async with runtime.condition:
        runtime.condition.notify_all()


def _schedule_forget(job_id: uuid.UUID) -> None:
    try:
        asyncio.get_running_loop().call_later(EVENT_RETENTION_SECONDS, _RUNTIMES.pop, job_id, None)
    except RuntimeError:
        _RUNTIMES.pop(job_id, None)


async def _finish(runtime: _Runtime, status: str, state: ProgressState, error: Optional[str]) -> None:
    # Persist the final state before releasing listeners: a page that sees the stream end and
    # re-reads the job must already find it finished.
    values: dict[str, Any] = {
        "status": status,
        "finished_at": datetime.now(timezone.utc),
        "error": (error or None) and error[:2000],
        "result_json": state.result,
    }
    if status == "succeeded":
        values.update(progress=1.0, progress_label=state.label or "Completato")
    elif state.label:
        values["progress_label"] = state.label[:300]
    await _update_job(runtime.job_id, **values)
    runtime.done = True
    await _notify(runtime)
    _schedule_forget(runtime.job_id)


async def start_stream_job(
    owner: JobOwner,
    *,
    kind: str,
    title: str,
    stream: AsyncIterator[Any],
    event_format: str = "sse",
    description: Optional[str] = None,
    route: Optional[str] = None,
    resource_id: Optional[str] = None,
    progress_fn: Optional[ProgressFn] = None,
    expected_seconds: Optional[float] = None,
    on_finish: Optional[FinishFn] = None,
) -> uuid.UUID:
    """Run `stream` (an async generator of SSE/NDJSON chunks) as a detached background job."""
    job_id = await _create_job(owner, kind=kind, title=title, description=description, route=route,
                               resource_id=resource_id, expected_seconds=expected_seconds)
    runtime = _Runtime(job_id=job_id, event_format=event_format)
    _RUNTIMES[job_id] = runtime

    async def run() -> None:
        state = ProgressState()
        buffer = ""
        last_write = 0.0
        written = (None, None)
        status, error = "succeeded", None
        try:
            async for chunk in stream:
                text = chunk.decode("utf-8", errors="replace") if isinstance(chunk, (bytes, bytearray)) else str(chunk)
                runtime.chunks.append(text)
                await _notify(runtime)
                events, buffer = _parse_events(buffer + text, event_format)
                for event in events:
                    if event.get("type") == "error":
                        state.error = str(event.get("message") or event.get("detail") or event.get("error") or "Errore")
                    if progress_fn:
                        try:
                            progress_fn(event, state)
                        except Exception:
                            logger.debug("progress fn failed for %s", kind, exc_info=True)
                now = time.monotonic()
                if (state.progress, state.label) != written and now - last_write >= PROGRESS_WRITE_INTERVAL:
                    last_write = now
                    written = (state.progress, state.label)
                    await _update_job(job_id, progress=state.progress, progress_label=(state.label or "")[:300] or None)
            if state.error:
                status, error = "failed", state.error
        except asyncio.CancelledError:
            status, error = "cancelled", "Annullato"
            runtime.chunks.append(_error_chunk(event_format, "Generazione annullata."))
        except Exception as exc:
            logger.exception("background job %s (%s) failed", job_id, kind)
            status, error = "failed", str(exc) or "Errore"
            runtime.chunks.append(_error_chunk(event_format, error))
        finally:
            if on_finish is not None:
                try:
                    await asyncio.shield(on_finish(status, state, runtime.listeners > 0))
                except Exception:
                    logger.exception("background job %s: on_finish failed", job_id)
            await asyncio.shield(_finish(runtime, status, state, error))

    runtime.task = asyncio.create_task(run(), name=f"job:{kind}:{job_id}")
    return job_id


class JobContext:
    """Handle given to a coroutine job to report progress."""

    def __init__(self, job_id: uuid.UUID):
        self.job_id = job_id
        self._last_write = 0.0

    async def progress(self, value: Optional[float] = None, label: Optional[str] = None, force: bool = False) -> None:
        now = time.monotonic()
        if not force and now - self._last_write < PROGRESS_WRITE_INTERVAL:
            return
        self._last_write = now
        values: dict[str, Any] = {}
        if value is not None:
            values["progress"] = max(0.0, min(1.0, float(value)))
        if label is not None:
            values["progress_label"] = label[:300]
        if values:
            await _update_job(self.job_id, **values)


async def start_task_job(
    owner: JobOwner,
    *,
    kind: str,
    title: str,
    work: Callable[[JobContext], Awaitable[Optional[dict]]],
    description: Optional[str] = None,
    route: Optional[str] = None,
    resource_id: Optional[str] = None,
    expected_seconds: Optional[float] = None,
) -> uuid.UUID:
    """Run a coroutine as a background job; its returned dict becomes the job result."""
    job_id = await _create_job(owner, kind=kind, title=title, description=description, route=route,
                               resource_id=resource_id, expected_seconds=expected_seconds)
    runtime = _Runtime(job_id=job_id, event_format="ndjson")
    _RUNTIMES[job_id] = runtime

    async def run() -> None:
        state = ProgressState()
        status, error = "succeeded", None
        try:
            state.result = await work(JobContext(job_id))
            runtime.chunks.append(json.dumps({"type": "done", "result": state.result}, default=str) + "\n")
        except asyncio.CancelledError:
            status, error = "cancelled", "Annullato"
            runtime.chunks.append(_error_chunk("ndjson", "Generazione annullata."))
        except Exception as exc:
            logger.exception("background job %s (%s) failed", job_id, kind)
            detail = getattr(exc, "detail", None)
            status, error = "failed", str(detail or exc) or "Errore"
            runtime.chunks.append(_error_chunk("ndjson", error))
        finally:
            await asyncio.shield(_finish(runtime, status, state, error))

    runtime.task = asyncio.create_task(run(), name=f"job:{kind}:{job_id}")
    return job_id


def is_live(job_id: uuid.UUID) -> bool:
    return job_id in _RUNTIMES


async def follow(job_id: uuid.UUID, start: int = 0, registered: bool = False) -> AsyncIterator[str]:
    """Replay the job's chunks from `start`, then follow new ones until the job ends.
    `registered`: the caller already counted this listener (see stream_response)."""
    runtime = _RUNTIMES.get(job_id)
    if runtime is None:
        return
    index = max(0, start)
    if not registered:
        runtime.listeners += 1
    try:
        async for chunk in _follow(runtime, index):
            yield chunk
    finally:
        runtime.listeners -= 1


async def _follow(runtime: _Runtime, index: int) -> AsyncIterator[str]:
    while True:
        async with runtime.condition:
            while index >= len(runtime.chunks) and not runtime.done:
                try:
                    await asyncio.wait_for(runtime.condition.wait(), timeout=15)
                except asyncio.TimeoutError:
                    break
        if index < len(runtime.chunks):
            pending = runtime.chunks[index:]
            index += len(pending)
            for chunk in pending:
                yield chunk
            continue
        if runtime.done:
            return
        # Keep proxies from closing an idle connection while the job is quiet.
        yield ": keep-alive\n\n" if runtime.event_format == "sse" else "\n"


def stream_response(job_id: uuid.UUID, media_type: str, start: int = 0) -> StreamingResponse:
    runtime = _RUNTIMES.get(job_id)
    if runtime is not None:
        # Count the listener now, not when the body starts streaming: a fast job must not look
        # abandoned just because the response hadn't begun yet.
        runtime.listeners += 1
    return StreamingResponse(
        follow(job_id, start, registered=runtime is not None),
        media_type=media_type,
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no", "X-Job-Id": str(job_id),
                 "Access-Control-Expose-Headers": "X-Job-Id"},
    )


async def cancel(job_id: uuid.UUID) -> bool:
    runtime = _RUNTIMES.get(job_id)
    if runtime is None or runtime.done or runtime.task is None:
        return False
    runtime.task.cancel()
    return True


async def mark_interrupted_jobs() -> None:
    """At startup: jobs left `running` by a previous process can't finish any more."""
    try:
        async with AsyncSessionLocal() as db:
            await db.execute(
                update(BackgroundJob)
                .where(BackgroundJob.status == "running")
                .values(status="interrupted", error="Il server è stato riavviato durante la generazione.",
                        finished_at=datetime.now(timezone.utc))
            )
            await db.commit()
    except Exception:
        logger.exception("could not mark interrupted background jobs")


def estimated_progress(job: BackgroundJob) -> Optional[float]:
    """Progress to draw: the reported value, or a time-based estimate while running."""
    if job.status != "running":
        return 1.0 if job.status == "succeeded" else job.progress
    elapsed = max(0.0, (datetime.now(timezone.utc) - job.created_at).total_seconds())
    expected = job.expected_seconds or 60.0
    by_time = 0.95 * (1 - math.exp(-2.2 * elapsed / expected))
    if job.progress is None:
        return by_time
    return max(job.progress, min(by_time, job.progress + 0.15))


def serialize(job: BackgroundJob) -> dict:
    return {
        "id": str(job.id),
        "kind": job.kind,
        "title": job.title,
        "description": job.description,
        "route": job.route,
        "resource_id": job.resource_id,
        "status": job.status,
        "progress": job.progress,
        "progress_display": estimated_progress(job),
        "progress_label": job.progress_label,
        "error": job.error,
        "result": job.result_json,
        "live": is_live(job.id),
        "created_at": job.created_at.isoformat(),
        "updated_at": job.updated_at.isoformat() if job.updated_at else None,
        "finished_at": job.finished_at.isoformat() if job.finished_at else None,
        "seen_at": job.seen_at.isoformat() if job.seen_at else None,
    }
