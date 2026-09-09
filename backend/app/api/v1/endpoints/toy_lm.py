"""
Toy LM API endpoints
====================
All routes require teacher authentication.

POST   /toy-lm/jobs                    — create job (corpus + hyperparams)
GET    /toy-lm/jobs                    — list teacher's jobs
GET    /toy-lm/jobs/{id}               — job status + metrics
PUT    /toy-lm/jobs/{id}               — rename job
DELETE /toy-lm/jobs/{id}              — delete job + checkpoint
POST   /toy-lm/jobs/{id}/start         — enqueue / resume
POST   /toy-lm/jobs/{id}/pause         — pause running job
POST   /toy-lm/jobs/{id}/resume        — resume paused job
POST   /toy-lm/jobs/{id}/stop          — stop running job
GET    /toy-lm/jobs/{id}/stream        — SSE stream (EventSource)
POST   /toy-lm/jobs/{id}/generate      — text autocompletion
GET    /toy-lm/jobs/{id}/embeddings    — checkpoint token embeddings
POST   /toy-lm/jobs/{id}/corpus        — update corpus text
GET    /toy-lm/queue                   — global queue status
"""

from __future__ import annotations

import json
import logging
import os
from datetime import datetime, timezone
from typing import Annotated, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_teacher, get_student_or_teacher, StudentOrTeacher
from app.core.database import get_db
from app.core.permissions import teacher_can_access_session
from app.models.chat import ChatMessage, ChatRoom
from app.models.enums import ChatRoomType, SenderType
from app.models.session import Session
from app.models.toy_lm import ToyLMJob, ToyLMJobPublication
from app.models.user import User
from app.realtime.gateway import sio
from app.services.toy_lm_trainer import build_toy_vocab, infer_vocab_token_mode, normalize_token_mode, toy_lm_service

logger = logging.getLogger(__name__)

router = APIRouter()

MAX_CORPUS_CHARS = 200_000


# ─── Schemas ──────────────────────────────────────────────────────────────────

class CreateJobBody(BaseModel):
    name: str = "Modello senza nome"
    corpus: str
    hyperparams: dict = {}

class UpdateCorpusBody(BaseModel):
    corpus: str

class RenameBody(BaseModel):
    name: str

class GenerateBody(BaseModel):
    seed: str
    max_tokens: int = 200
    temperature: float = 0.8

class SharedGenerateBody(GenerateBody):
    session_id: UUID

class HyperparamsBody(BaseModel):
    hyperparams: dict

class PublishBody(BaseModel):
    session_id: UUID


# ─── Helpers ──────────────────────────────────────────────────────────────────

async def _get_job(job_id: str, teacher: User, db: AsyncSession) -> ToyLMJob:
    try:
        uid = UUID(job_id)
    except ValueError:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "ID non valido")
    row = await db.get(ToyLMJob, uid)
    if not row or row.teacher_id != teacher.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Job non trovato")
    return row


async def _get_or_create_public_room(db: AsyncSession, session: Session) -> ChatRoom:
    result = await db.execute(
        select(ChatRoom)
        .where(ChatRoom.session_id == session.id)
        .where(ChatRoom.room_type == ChatRoomType.PUBLIC)
        .limit(1)
    )
    room = result.scalar_one_or_none()
    if room:
        return room

    room = ChatRoom(
        tenant_id=session.tenant_id,
        session_id=session.id,
        room_type=ChatRoomType.PUBLIC,
    )
    db.add(room)
    await db.flush()
    return room


def _assert_checkpoint_ready(row: ToyLMJob) -> None:
    if not row.checkpoint_path or not os.path.exists(row.checkpoint_path):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Nessun checkpoint disponibile — esegui almeno una epoch di training",
        )
    active = toy_lm_service.get_active(str(row.id))
    if active and not active.pause_event.is_set():
        raise HTTPException(status.HTTP_409_CONFLICT, "Training in corso — metti in pausa prima di generare")
    if not row.vocab_json:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Vocab mancante")


async def _generate_from_job(row: ToyLMJob, body: GenerateBody) -> dict:
    _assert_checkpoint_ready(row)
    loop = __import__("asyncio").get_event_loop()
    text = await loop.run_in_executor(
        None,
        toy_lm_service.generate_sync,
        row.checkpoint_path,
        row.vocab_json,
        row.hyperparams_json or {},
        body.seed[:500],
        min(body.max_tokens, 1000),
        body.temperature,
    )
    return {"generated": text}


async def _embeddings_from_job(row: ToyLMJob) -> dict:
    _assert_checkpoint_ready(row)
    loop = __import__("asyncio").get_event_loop()
    return await loop.run_in_executor(
        None,
        toy_lm_service.embeddings_sync,
        row.checkpoint_path,
        row.vocab_json,
        row.hyperparams_json or {},
    )


def _count_params(vocab_size: int, params: dict) -> int:
    embed_dim = int(params.get("embedDim", 32))
    hidden_size = int(params.get("hiddenSize", 128))
    num_layers = int(params.get("numLayers", 2))
    # Embedding
    n = vocab_size * embed_dim
    # LSTM (each layer: 4 gates, each gate has input + recurrent weights + bias)
    for layer in range(num_layers):
        input_size = embed_dim if layer == 0 else hidden_size
        n += 4 * (input_size * hidden_size + hidden_size * hidden_size + 2 * hidden_size)
    # FC
    n += hidden_size * vocab_size + vocab_size
    return n


def _job_to_dict(row: ToyLMJob, queue_pos: int = -1) -> dict:
    return {
        "id": str(row.id),
        "name": row.name,
        "status": row.status,
        "corpusCharCount": row.corpus_char_count,
        "hyperparams": row.hyperparams_json,
        "vocabSize": (row.vocab_json or {}).get("vocabSize", 0),
        "tokenMode": infer_vocab_token_mode(row.vocab_json or {}, row.hyperparams_json or {}),
        "savedEpoch": row.saved_epoch,
        "paramCount": row.param_count,
        "metrics": row.metrics_json,
        "errorMessage": row.error_message,
        "queuePosition": queue_pos,
        "createdAt": row.created_at.isoformat() if row.created_at else None,
        "startedAt": row.started_at.isoformat() if row.started_at else None,
        "completedAt": row.completed_at.isoformat() if row.completed_at else None,
    }


# ─── Endpoints ────────────────────────────────────────────────────────────────

@router.post("/jobs", status_code=201)
async def create_job(
    body: CreateJobBody,
    db: Annotated[AsyncSession, Depends(get_db)],
    teacher: Annotated[User, Depends(get_current_teacher)],
):
    corpus = body.corpus[:MAX_CORPUS_CHARS]
    params = {
        "seqLen": 40, "batchSize": 64, "embedDim": 32,
        "hiddenSize": 128, "numLayers": 2,
        "learningRate": 0.002, "totalEpochs": 20,
        "metricEvery": 20,
        "tokenMode": "word",
        **body.hyperparams,
    }
    params["tokenMode"] = normalize_token_mode(params.get("tokenMode"))
    vocab = build_toy_vocab(corpus, params["tokenMode"])
    n_params = _count_params(vocab["vocabSize"], params)

    row = ToyLMJob(
        teacher_id=teacher.id,
        tenant_id=teacher.tenant_id,
        name=body.name[:120],
        status="draft",
        corpus_text=corpus,
        corpus_char_count=len(corpus),
        hyperparams_json=params,
        vocab_json=vocab,
        param_count=n_params,
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return _job_to_dict(row)


@router.get("/jobs")
async def list_jobs(
    db: Annotated[AsyncSession, Depends(get_db)],
    teacher: Annotated[User, Depends(get_current_teacher)],
):
    rows = (await db.execute(
        select(ToyLMJob)
        .where(ToyLMJob.teacher_id == teacher.id)
        .order_by(ToyLMJob.created_at.desc())
        .limit(50)
    )).scalars().all()
    return [_job_to_dict(r, toy_lm_service.queue_position(str(r.id))) for r in rows]


@router.get("/jobs/{job_id}")
async def get_job(
    job_id: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    teacher: Annotated[User, Depends(get_current_teacher)],
):
    row = await _get_job(job_id, teacher, db)
    await db.refresh(row)
    return _job_to_dict(row, toy_lm_service.queue_position(job_id))


@router.put("/jobs/{job_id}")
async def rename_job(
    job_id: str,
    body: RenameBody,
    db: Annotated[AsyncSession, Depends(get_db)],
    teacher: Annotated[User, Depends(get_current_teacher)],
):
    row = await _get_job(job_id, teacher, db)
    row.name = body.name[:120]
    await db.commit()
    return {"ok": True}


@router.delete("/jobs/{job_id}")
async def delete_job(
    job_id: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    teacher: Annotated[User, Depends(get_current_teacher)],
):
    row = await _get_job(job_id, teacher, db)
    toy_lm_service.stop(job_id)
    if row.checkpoint_path and os.path.exists(row.checkpoint_path):
        try:
            os.remove(row.checkpoint_path)
        except OSError:
            pass
    await db.delete(row)
    await db.commit()
    return {"ok": True}


@router.post("/jobs/{job_id}/corpus")
async def update_corpus(
    job_id: str,
    body: UpdateCorpusBody,
    db: Annotated[AsyncSession, Depends(get_db)],
    teacher: Annotated[User, Depends(get_current_teacher)],
):
    row = await _get_job(job_id, teacher, db)
    if row.status not in ("draft", "stopped", "completed", "failed"):
        raise HTTPException(status.HTTP_409_CONFLICT, "Ferma il training prima di modificare il corpus")
    corpus = body.corpus[:MAX_CORPUS_CHARS]
    params = row.hyperparams_json or {}
    params["tokenMode"] = normalize_token_mode(params.get("tokenMode"))
    vocab = build_toy_vocab(corpus, params["tokenMode"])
    row.corpus_text = corpus
    row.corpus_char_count = len(corpus)
    row.vocab_json = vocab
    row.param_count = _count_params(vocab["vocabSize"], params)
    # Reset training state when corpus changes
    row.saved_epoch = 0
    row.metrics_json = []
    row.checkpoint_path = None
    row.status = "draft"
    await db.commit()
    return _job_to_dict(row)


@router.post("/jobs/{job_id}/hyperparams")
async def update_hyperparams(
    job_id: str,
    body: HyperparamsBody,
    db: Annotated[AsyncSession, Depends(get_db)],
    teacher: Annotated[User, Depends(get_current_teacher)],
):
    row = await _get_job(job_id, teacher, db)
    if row.status == "running":
        raise HTTPException(status.HTTP_409_CONFLICT, "Ferma il training prima di cambiare gli iperparametri")
    params = {**(row.hyperparams_json or {}), **body.hyperparams}
    row.hyperparams_json = params
    if row.vocab_json:
        row.param_count = _count_params(row.vocab_json.get("vocabSize", 1), params)
    await db.commit()
    return _job_to_dict(row)


@router.post("/jobs/{job_id}/start")
async def start_job(
    job_id: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    teacher: Annotated[User, Depends(get_current_teacher)],
):
    row = await _get_job(job_id, teacher, db)

    # Only short-circuit if the job is *actually* active/queued in memory. After a
    # restart the DB can hold a stale 'running'/'queued' status with an empty queue;
    # in that case we fall through and re-enqueue instead of getting stuck.
    if row.status == "running" and toy_lm_service.get_active(job_id):
        return {"ok": True, "queuePosition": 0, "message": "Già in esecuzione"}

    if row.status == "queued":
        pos = toy_lm_service.queue_position(job_id)
        if pos > 0:
            return {"ok": True, "queuePosition": pos, "message": f"In coda (posizione {pos})"}

    if not row.corpus_text:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Carica un corpus prima di avviare il training")

    if not row.vocab_json:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Vocab non trovato — ri-carica il corpus")

    row.status = "queued"
    await db.commit()

    pos = await toy_lm_service.enqueue(job_id)
    return {"ok": True, "queuePosition": pos, "message": f"In coda (posizione {pos})"}


@router.post("/jobs/{job_id}/pause")
async def pause_job(
    job_id: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    teacher: Annotated[User, Depends(get_current_teacher)],
):
    await _get_job(job_id, teacher, db)
    ok = toy_lm_service.pause(job_id)
    return {"ok": ok}


@router.post("/jobs/{job_id}/resume")
async def resume_job(
    job_id: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    teacher: Annotated[User, Depends(get_current_teacher)],
):
    row = await _get_job(job_id, teacher, db)
    # A paused job has exited its training thread (releasing the GPU). Resuming
    # re-enqueues it; training restarts from the last checkpointed epoch.
    if toy_lm_service.get_active(job_id):
        return {"ok": True, "queuePosition": 0, "message": "Già in esecuzione"}
    if not row.corpus_text or not row.vocab_json:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Corpus mancante — ri-carica il corpus")
    row.status = "queued"
    await db.commit()
    pos = await toy_lm_service.enqueue(job_id)
    return {"ok": True, "queuePosition": pos, "message": f"In coda (posizione {pos})"}


@router.post("/jobs/{job_id}/stop")
async def stop_job(
    job_id: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    teacher: Annotated[User, Depends(get_current_teacher)],
):
    row = await _get_job(job_id, teacher, db)
    ok = toy_lm_service.stop(job_id)
    if row.status in ("running", "queued"):
        row.status = "stopped"
        await db.commit()
    return {"ok": ok}


@router.get("/jobs/{job_id}/stream")
async def stream_metrics(
    job_id: str,
    teacher: Annotated[User, Depends(get_current_teacher)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """SSE stream of training metrics. Safe to reconnect at any time."""
    await _get_job(job_id, teacher, db)

    async def event_generator():
        active = toy_lm_service.get_active(job_id)
        if not active:
            # Not running right now — send queue position and close
            pos = toy_lm_service.queue_position(job_id)
            yield f"data: {json.dumps({'type': 'queued', 'queuePosition': pos})}\n\n"
            return

        while True:
            event = await active.next_event(timeout=25.0)
            if event is None:
                break
            yield f"data: {json.dumps(event)}\n\n"
            if event.get("type") in ("done", "error"):
                break

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",  # disable nginx buffering
        },
    )


@router.post("/jobs/{job_id}/generate")
async def generate_text(
    job_id: str,
    body: GenerateBody,
    teacher: Annotated[User, Depends(get_current_teacher)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    row = await _get_job(job_id, teacher, db)
    return await _generate_from_job(row, body)


@router.get("/jobs/{job_id}/embeddings")
async def get_embeddings(
    job_id: str,
    teacher: Annotated[User, Depends(get_current_teacher)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    row = await _get_job(job_id, teacher, db)
    return await _embeddings_from_job(row)


@router.post("/jobs/{job_id}/publish")
async def publish_job_to_session(
    job_id: str,
    body: PublishBody,
    db: Annotated[AsyncSession, Depends(get_db)],
    teacher: Annotated[User, Depends(get_current_teacher)],
):
    row = await _get_job(job_id, teacher, db)
    _assert_checkpoint_ready(row)

    if not await teacher_can_access_session(db, teacher, body.session_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Sessione non trovata")

    session = await db.get(Session, body.session_id)
    if not session:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Sessione non trovata")

    room = await _get_or_create_public_room(db, session)
    attachment = {
        "type": "toy_lm_model",
        "job_id": str(row.id),
        "name": row.name,
        "vocab_size": (row.vocab_json or {}).get("vocabSize", 0),
        "saved_epoch": row.saved_epoch,
        "param_count": row.param_count,
    }
    message_text = f"Modello Toy LM condiviso: {row.name}"

    chat_message = ChatMessage(
        tenant_id=session.tenant_id,
        session_id=session.id,
        room_id=room.id,
        sender_type=SenderType.TEACHER,
        sender_teacher_id=teacher.id,
        message_text=message_text,
        attachments=[attachment],
    )
    db.add(chat_message)
    await db.flush()
    await db.refresh(chat_message)

    result = await db.execute(
        select(ToyLMJobPublication)
        .where(ToyLMJobPublication.job_id == row.id)
        .where(ToyLMJobPublication.session_id == session.id)
        .limit(1)
    )
    publication = result.scalar_one_or_none()
    if publication:
        publication.chat_message_id = chat_message.id
    else:
        publication = ToyLMJobPublication(
            job_id=row.id,
            session_id=session.id,
            tenant_id=session.tenant_id,
            teacher_id=teacher.id,
            chat_message_id=chat_message.id,
        )
        db.add(publication)

    await db.commit()
    await db.refresh(publication)

    await sio.emit(
        "chat_message",
        {
            "room_type": "PUBLIC",
            "session_id": str(session.id),
            "message": {
                "id": str(chat_message.id),
                "sender_type": "TEACHER",
                "sender_id": str(teacher.id),
                "sender_name": "Docente",
                "sender_accent": teacher.ui_accent,
                "text": message_text,
                "attachments": [attachment],
                "created_at": chat_message.created_at.isoformat(),
            },
        },
        room=f"session:{session.id}",
    )

    return {
        "ok": True,
        "publication_id": str(publication.id),
        "message_id": str(chat_message.id),
    }


@router.post("/shared/jobs/{job_id}/generate")
async def generate_shared_text(
    job_id: str,
    body: SharedGenerateBody,
    auth: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    try:
        uid = UUID(job_id)
    except ValueError:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "ID non valido")

    if auth.is_student:
        if auth.student.session_id != body.session_id:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Access denied")
        tenant_id = auth.student.tenant_id
    else:
        if not await teacher_can_access_session(db, auth.teacher, body.session_id):
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Sessione non trovata")
        tenant_id = auth.teacher.tenant_id

    result = await db.execute(
        select(ToyLMJobPublication)
        .where(ToyLMJobPublication.job_id == uid)
        .where(ToyLMJobPublication.session_id == body.session_id)
        .limit(1)
    )
    publication = result.scalar_one_or_none()
    if not publication:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Modello non condiviso in questa sessione")

    row = await db.get(ToyLMJob, uid)
    if not row or row.tenant_id != tenant_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Modello non trovato")

    return await _generate_from_job(row, body)


@router.get("/queue")
async def queue_status(
    teacher: Annotated[User, Depends(get_current_teacher)],
):
    """Global GPU queue info."""
    active_ids = list(toy_lm_service._active.keys())
    pending_ids = list(toy_lm_service._queue_order)
    return {
        "active": active_ids,
        "pending": pending_ids,
        "queueLength": len(pending_ids),
        "gpuAvailable": torch.cuda.is_available(),
        "gpuName": torch.cuda.get_device_name(0) if torch.cuda.is_available() else "CPU",
    }


import torch  # noqa: E402 — imported after body to keep type stub happy
