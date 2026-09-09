import json
import os
from datetime import datetime, timezone
from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_student, get_current_teacher
from app.core.database import get_db
from app.core.permissions import teacher_can_access_session
from app.models.live_interaction import LiveInteraction, LiveInteractionResponse
from app.models.session import Session, SessionStudent
from app.models.user import User
from app.realtime.gateway import sio
from app.services.credit_service import credit_service
from app.services.document_processor import document_processor
from app.services.json_extract import extract_json
from app.services.llm_service import llm_service

teacher_router = APIRouter()
student_router = APIRouter()

REPORTS_DIR = os.environ.get("LIVE_REPORTS_DIR", "/app/live_interaction_reports")

SLIDE_TYPES = ("mcq", "wordwall", "opinion", "feedback")

SLIDE_TYPE_DESCRIPTIONS = """- mcq: domanda a risposta multipla. Campi: question (string), options (array di 2-6 stringhe brevi), correct_option (indice intero dell'opzione corretta, o null se non applicabile).
- wordwall: nuvola di parole. Campi: prompt (string, invito a rispondere con una parola/breve espressione).
- opinion: opinione libera in una frase. Campi: prompt (string).
- feedback: feedback rapido (sentiment positivo/neutro/negativo). Campi: prompt (string, es. "Come hai trovato questa attività?")."""

REFERENCE_MAX_CHARS = 12000


# ── Pydantic schemas ──

class LiveInteractionCreate(BaseModel):
    session_id: str
    title: str
    slides_json: list[dict] = []


class LiveInteractionUpdate(BaseModel):
    title: str | None = None
    slides_json: list[dict] | None = None


class AnswerSubmit(BaseModel):
    live_interaction_id: str
    slide_index: int
    response: dict


class SlideAssistRequest(BaseModel):
    slide_type: Literal["mcq", "wordwall", "opinion", "feedback"]
    draft_text: str
    session_id: str
    other_slides: list[dict] = []
    reference_text: str | None = None


class StructureAssistRequest(BaseModel):
    session_id: str
    topic: str
    num_slides: int = 5
    reference_text: str | None = None


# ── Helper ──

async def _broadcast_state(session_id: str, li: LiveInteraction, response_count: int, total_students: int):
    slides = li.slides_json or []
    current_slide = slides[li.current_slide_index] if 0 <= li.current_slide_index < len(slides) else None
    await sio.emit(
        "live_interaction_state",
        {
            "live_interaction_id": str(li.id),
            "title": li.title,
            "status": li.status,
            "current_slide_index": li.current_slide_index,
            "total_slides": len(slides),
            "current_slide": current_slide,
            "current_slide_started_at": li.current_slide_started_at.isoformat() if li.current_slide_started_at else None,
            "response_count": response_count,
            "total_students": total_students,
        },
        room=f"session:{session_id}",
    )


async def _save_report(db: AsyncSession, li: LiveInteraction):
    try:
        rows = (await db.execute(
            select(LiveInteractionResponse, SessionStudent.nickname)
            .join(SessionStudent, LiveInteractionResponse.student_id == SessionStudent.id)
            .where(LiveInteractionResponse.live_interaction_id == li.id)
            .order_by(LiveInteractionResponse.slide_index, LiveInteractionResponse.created_at)
        )).all()

        slides_data: dict[int, dict] = {}
        for resp, nickname in rows:
            idx = resp.slide_index
            if idx not in slides_data:
                slides_data[idx] = {
                    "slide_index": idx,
                    "slide_config": (li.slides_json or [])[idx] if idx < len(li.slides_json or []) else {},
                    "responses": [],
                }
            slides_data[idx]["responses"].append({
                "student_nickname": nickname,
                "response": resp.response_json,
                "created_at": resp.created_at.isoformat(),
            })

        report = {
            "live_interaction_id": str(li.id),
            "title": li.title,
            "session_id": str(li.session_id),
            "status": li.status,
            "slides": li.slides_json,
            "results": [slides_data[i] for i in sorted(slides_data.keys())],
            "exported_at": datetime.now(timezone.utc).isoformat(),
        }

        os.makedirs(REPORTS_DIR, exist_ok=True)
        safe_title = "".join(c for c in li.title if c.isalnum() or c in (" ", "-", "_")).strip()[:50]
        filename = f"{li.session_id}_{li.id}_{safe_title}.json"
        with open(os.path.join(REPORTS_DIR, filename), "w", encoding="utf-8") as f:
            json.dump(report, f, ensure_ascii=False, indent=2)
    except Exception as exc:
        print(f"[LiveInteraction] Failed to save report: {exc}")


async def _count_responses(db: AsyncSession, li_id: UUID, slide_index: int) -> int:
    return (await db.scalar(
        select(func.count()).select_from(LiveInteractionResponse)
        .where(LiveInteractionResponse.live_interaction_id == li_id)
        .where(LiveInteractionResponse.slide_index == slide_index)
    )) or 0


async def _count_students(db: AsyncSession, session_id: UUID) -> int:
    return (await db.scalar(
        select(func.count()).select_from(SessionStudent)
        .where(SessionStudent.session_id == session_id)
    )) or 0


# ── Teacher endpoints ──

@teacher_router.get("/live-interactions")
async def list_live_interactions(
    session_id: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    teacher: Annotated[User, Depends(get_current_teacher)],
):
    if not await teacher_can_access_session(db, teacher, UUID(session_id)):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Session not found")
    rows = (await db.execute(
        select(LiveInteraction)
        .where(LiveInteraction.session_id == UUID(session_id))
        .order_by(LiveInteraction.created_at.desc())
    )).scalars().all()
    return [
        {
            "id": str(li.id),
            "title": li.title,
            "status": li.status,
            "slides_count": len(li.slides_json or []),
            "slides_json": li.slides_json or [],
            "current_slide_index": li.current_slide_index,
            "created_at": li.created_at.isoformat(),
        }
        for li in rows
    ]


@teacher_router.post("/live-interactions", status_code=201)
async def create_live_interaction(
    body: LiveInteractionCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
    teacher: Annotated[User, Depends(get_current_teacher)],
):
    if not await teacher_can_access_session(db, teacher, UUID(body.session_id)):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Session not found")
    li = LiveInteraction(
        session_id=UUID(body.session_id),
        created_by=teacher.id,
        title=body.title,
        slides_json=body.slides_json,
    )
    db.add(li)
    await db.commit()
    await db.refresh(li)
    return {"id": str(li.id), "title": li.title, "status": li.status}


@teacher_router.get("/live-interactions/{interaction_id}")
async def get_live_interaction(
    interaction_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    teacher: Annotated[User, Depends(get_current_teacher)],
):
    li = (await db.execute(select(LiveInteraction).where(LiveInteraction.id == interaction_id))).scalar_one_or_none()
    if not li:
        raise HTTPException(404, "Not found")
    if not await teacher_can_access_session(db, teacher, li.session_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Session not found")
    return {
        "id": str(li.id),
        "session_id": str(li.session_id),
        "title": li.title,
        "status": li.status,
        "slides_json": li.slides_json,
        "current_slide_index": li.current_slide_index,
        "current_slide_started_at": li.current_slide_started_at.isoformat() if li.current_slide_started_at else None,
        "created_at": li.created_at.isoformat(),
        "updated_at": li.updated_at.isoformat(),
    }


@teacher_router.put("/live-interactions/{interaction_id}")
async def update_live_interaction(
    interaction_id: UUID,
    body: LiveInteractionUpdate,
    db: Annotated[AsyncSession, Depends(get_db)],
    teacher: Annotated[User, Depends(get_current_teacher)],
):
    li = (await db.execute(select(LiveInteraction).where(LiveInteraction.id == interaction_id))).scalar_one_or_none()
    if not li:
        raise HTTPException(404, "Not found")
    if not await teacher_can_access_session(db, teacher, li.session_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Session not found")
    if li.status == "ACTIVE":
        raise HTTPException(400, "Cannot edit an active live interaction")
    if body.title is not None:
        li.title = body.title
    if body.slides_json is not None:
        li.slides_json = body.slides_json
    await db.commit()
    return {"id": str(li.id), "title": li.title, "status": li.status}


@teacher_router.delete("/live-interactions/{interaction_id}", status_code=204)
async def delete_live_interaction(
    interaction_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    teacher: Annotated[User, Depends(get_current_teacher)],
):
    li = (await db.execute(select(LiveInteraction).where(LiveInteraction.id == interaction_id))).scalar_one_or_none()
    if not li:
        raise HTTPException(404, "Not found")
    if not await teacher_can_access_session(db, teacher, li.session_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Session not found")
    await db.delete(li)
    await db.commit()


@teacher_router.post("/live-interactions/{interaction_id}/start")
async def start_live_interaction(
    interaction_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    teacher: Annotated[User, Depends(get_current_teacher)],
):
    li = (await db.execute(select(LiveInteraction).where(LiveInteraction.id == interaction_id))).scalar_one_or_none()
    if not li:
        raise HTTPException(404, "Not found")
    if not await teacher_can_access_session(db, teacher, li.session_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Session not found")
    if not li.slides_json:
        raise HTTPException(400, "No slides defined")

    li.status = "ACTIVE"
    li.current_slide_index = 0
    li.current_slide_started_at = datetime.now(timezone.utc)
    await db.commit()

    rc = await _count_responses(db, li.id, 0)
    sc = await _count_students(db, li.session_id)
    await _broadcast_state(str(li.session_id), li, rc, sc)
    return {"status": "ACTIVE", "current_slide_index": 0}


@teacher_router.post("/live-interactions/{interaction_id}/next")
async def next_slide(
    interaction_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    teacher: Annotated[User, Depends(get_current_teacher)],
):
    li = (await db.execute(select(LiveInteraction).where(LiveInteraction.id == interaction_id))).scalar_one_or_none()
    if not li:
        raise HTTPException(404, "Not found")
    if not await teacher_can_access_session(db, teacher, li.session_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Session not found")
    if li.status != "ACTIVE":
        raise HTTPException(400, "Interaction not active")

    slides = li.slides_json or []
    next_index = li.current_slide_index + 1

    if next_index >= len(slides):
        li.status = "CLOSED"
        await db.commit()
        await _save_report(db, li)
        await sio.emit("live_interaction_state", {"live_interaction_id": str(li.id), "status": "CLOSED"}, room=f"session:{li.session_id}")
        return {"status": "CLOSED"}

    li.current_slide_index = next_index
    li.current_slide_started_at = datetime.now(timezone.utc)
    await db.commit()

    rc = await _count_responses(db, li.id, next_index)
    sc = await _count_students(db, li.session_id)
    await _broadcast_state(str(li.session_id), li, rc, sc)
    return {"status": "ACTIVE", "current_slide_index": next_index}


@teacher_router.post("/live-interactions/{interaction_id}/end")
async def end_live_interaction(
    interaction_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    teacher: Annotated[User, Depends(get_current_teacher)],
):
    li = (await db.execute(select(LiveInteraction).where(LiveInteraction.id == interaction_id))).scalar_one_or_none()
    if not li:
        raise HTTPException(404, "Not found")
    if not await teacher_can_access_session(db, teacher, li.session_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Session not found")

    li.status = "CLOSED"
    await db.commit()
    await _save_report(db, li)
    await sio.emit("live_interaction_state", {"live_interaction_id": str(li.id), "status": "CLOSED"}, room=f"session:{li.session_id}")
    return {"status": "CLOSED"}


@teacher_router.get("/live-interactions/{interaction_id}/results")
async def get_results(
    interaction_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    teacher: Annotated[User, Depends(get_current_teacher)],
):
    li = (await db.execute(select(LiveInteraction).where(LiveInteraction.id == interaction_id))).scalar_one_or_none()
    if not li:
        raise HTTPException(404, "Not found")
    if not await teacher_can_access_session(db, teacher, li.session_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Session not found")

    rows = (await db.execute(
        select(LiveInteractionResponse, SessionStudent.nickname)
        .join(SessionStudent, LiveInteractionResponse.student_id == SessionStudent.id)
        .where(LiveInteractionResponse.live_interaction_id == interaction_id)
        .order_by(LiveInteractionResponse.slide_index, LiveInteractionResponse.created_at)
    )).all()

    slides_data: dict[int, dict] = {}
    for resp, nickname in rows:
        idx = resp.slide_index
        if idx not in slides_data:
            slides_data[idx] = {
                "slide_index": idx,
                "slide_config": (li.slides_json or [])[idx] if idx < len(li.slides_json or []) else {},
                "responses": [],
            }
        slides_data[idx]["responses"].append({
            "student_nickname": nickname,
            "response": resp.response_json,
            "created_at": resp.created_at.isoformat(),
        })

    return {
        "live_interaction_id": str(li.id),
        "title": li.title,
        "session_id": str(li.session_id),
        "status": li.status,
        "slides": li.slides_json,
        "results": [slides_data[i] for i in sorted(slides_data.keys())],
        "created_at": li.created_at.isoformat(),
    }


@teacher_router.post("/live-interactions/extract-reference")
async def extract_reference_document(
    db: Annotated[AsyncSession, Depends(get_db)],
    teacher: Annotated[User, Depends(get_current_teacher)],
    session_id: Annotated[str, Form(...)],
    file: UploadFile = File(...),
):
    if not await teacher_can_access_session(db, teacher, UUID(session_id)):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Session not found")

    filename = file.filename or "documento.pdf"
    if not filename.lower().endswith(".pdf"):
        raise HTTPException(422, "Sono supportati solo file PDF")

    file_bytes = await file.read()
    if len(file_bytes) > 15 * 1024 * 1024:
        raise HTTPException(413, "File troppo grande (max 15 MB)")

    analysis = await document_processor.process(
        file_bytes=file_bytes,
        filename=filename,
        mime_type="application/pdf",
        llm_service=None,
        analyze_visuals=False,
    )

    raw_text = (analysis.raw_text or "").strip()
    if not raw_text:
        raise HTTPException(422, "Nessun testo leggibile trovato nel PDF")

    truncated = len(raw_text) > REFERENCE_MAX_CHARS
    reference_text = raw_text[:REFERENCE_MAX_CHARS]

    return {
        "filename": filename,
        "page_count": analysis.page_count,
        "char_count": len(reference_text),
        "truncated": truncated,
        "reference_text": reference_text,
    }


@teacher_router.post("/live-interactions/assist-slide")
async def assist_slide(
    body: SlideAssistRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    teacher: Annotated[User, Depends(get_current_teacher)],
):
    if not await teacher_can_access_session(db, teacher, UUID(body.session_id)):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Session not found")
    if not body.draft_text.strip():
        raise HTTPException(422, "draft_text required")

    allowed = await credit_service.check_availability(db, teacher.tenant_id, 0.0002, teacher_id=teacher.id)
    if not allowed:
        raise HTTPException(402, "Credit limit exceeded")

    other_context = ""
    if body.other_slides:
        lines = [s.get("question") or s.get("prompt") or "" for s in body.other_slides]
        lines = [l for l in lines if l.strip()]
        if lines:
            other_context = "\n\nAltre slide già presenti in questa sessione (per evitare ripetizioni e mantenere coerenza):\n" + "\n".join(f"- {l}" for l in lines)

    reference_context = ""
    if body.reference_text and body.reference_text.strip():
        reference_context = (
            "\n\nDocumento di riferimento fornito dal docente — ANCORA la slide a questo contenuto: "
            "usa solo fatti/informazioni presenti nel documento, non inventare nulla che lo contraddica.\n"
            f"{body.reference_text.strip()[:REFERENCE_MAX_CHARS]}"
        )

    system_prompt = f"""Sei un assistente per docenti che costruiscono quiz interattivi per lezioni in classe (piattaforma "Live Interaction").
Il docente sta componendo una slide di tipo "{body.slide_type}". Tipi disponibili e relativo schema JSON:
{SLIDE_TYPE_DESCRIPTIONS}

Il docente ha scritto questa bozza (domanda o prompt): "{body.draft_text}"
{other_context}
{reference_context}

Completa/migliora la slide di tipo "{body.slide_type}" a partire dalla bozza, restando fedele all'argomento scritto dal docente.
Rispondi SOLO con un oggetto JSON valido contenente esclusivamente i campi previsti per questo tipo di slide (vedi schema sopra). Nessun testo fuori dal JSON."""

    llm_response = await llm_service.generate(
        messages=[{"role": "user", "content": body.draft_text}],
        system_prompt=system_prompt,
        temperature=0.6,
        max_tokens=600,
    )

    try:
        suggestion = extract_json(llm_response.content)
    except ValueError:
        raise HTTPException(502, "Risposta AI non valida")

    cost = credit_service.calculate_cost_for_model(llm_response.provider, llm_response.model, llm_response.prompt_tokens, llm_response.completion_tokens)
    await credit_service.track_usage(
        db, teacher.tenant_id, llm_response.provider, llm_response.model, cost,
        {
            "type": "live_interaction_slide_assist",
            "slide_type": body.slide_type,
            "prompt_tokens": llm_response.prompt_tokens,
            "completion_tokens": llm_response.completion_tokens,
        },
        teacher_id=teacher.id, session_id=UUID(body.session_id),
    )

    return suggestion


@teacher_router.post("/live-interactions/assist-structure")
async def assist_structure(
    body: StructureAssistRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    teacher: Annotated[User, Depends(get_current_teacher)],
):
    session_id = UUID(body.session_id)
    if not await teacher_can_access_session(db, teacher, session_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Session not found")
    if not body.topic.strip():
        raise HTTPException(422, "topic required")
    num_slides = max(3, min(8, body.num_slides))

    allowed = await credit_service.check_availability(db, teacher.tenant_id, 0.0006, teacher_id=teacher.id)
    if not allowed:
        raise HTTPException(402, "Credit limit exceeded")

    current_session = (await db.execute(select(Session).where(Session.id == session_id))).scalar_one()

    past_rows = (await db.execute(
        select(LiveInteraction)
        .join(Session, LiveInteraction.session_id == Session.id)
        .where(Session.class_id == current_session.class_id)
        .where(LiveInteraction.session_id != session_id)
        .order_by(LiveInteraction.created_at.desc())
        .limit(5)
    )).scalars().all()

    past_context = ""
    if past_rows:
        summaries = []
        for li in past_rows:
            questions = [s.get("question") or s.get("prompt") or "" for s in (li.slides_json or [])]
            questions = [q for q in questions if q.strip()]
            summaries.append(f'- "{li.title}": ' + "; ".join(questions[:6]))
        past_context = "\n\nLavoro già svolto in questa classe (altre sessioni live), da non ripetere e con cui mantenere continuità:\n" + "\n".join(summaries)

    reference_context = ""
    if body.reference_text and body.reference_text.strip():
        reference_context = (
            "\n\nDocumento di riferimento fornito dal docente — ANCORA l'intera struttura a questo contenuto: "
            "usa solo fatti/informazioni presenti nel documento, non inventare nulla che lo contraddica.\n"
            f"{body.reference_text.strip()[:REFERENCE_MAX_CHARS]}"
        )

    system_prompt = f"""Sei un assistente per docenti che costruiscono quiz interattivi per lezioni in classe (piattaforma "Live Interaction").
Tipi di slide disponibili e relativo schema JSON:
{SLIDE_TYPE_DESCRIPTIONS}

Il docente vuole una sessione live sull'argomento: "{body.topic}".
{past_context}
{reference_context}

Proponi una sequenza di {num_slides} slide, variando i tipi (non usare solo mcq), coerente con l'argomento e, se presente, in continuità col lavoro già svolto senza ripetere le stesse domande.
Rispondi SOLO con un oggetto JSON valido con questa forma:
{{"title": "titolo breve della sessione", "slides": [ {{"type": "mcq|wordwall|opinion|feedback", ...campi previsti per quel tipo...}}, ... ]}}
Nessun testo fuori dal JSON."""

    llm_response = await llm_service.generate(
        messages=[{"role": "user", "content": body.topic}],
        system_prompt=system_prompt,
        temperature=0.7,
        max_tokens=2000,
    )

    try:
        structure = extract_json(llm_response.content)
    except ValueError:
        raise HTTPException(502, "Risposta AI non valida")

    raw_slides = structure.get("slides") if isinstance(structure, dict) else None
    slides = [s for s in (raw_slides or []) if isinstance(s, dict) and s.get("type") in SLIDE_TYPES]
    title = (structure.get("title") if isinstance(structure, dict) else None) or body.topic

    cost = credit_service.calculate_cost_for_model(llm_response.provider, llm_response.model, llm_response.prompt_tokens, llm_response.completion_tokens)
    await credit_service.track_usage(
        db, teacher.tenant_id, llm_response.provider, llm_response.model, cost,
        {
            "type": "live_interaction_structure_assist",
            "topic": body.topic,
            "prompt_tokens": llm_response.prompt_tokens,
            "completion_tokens": llm_response.completion_tokens,
        },
        teacher_id=teacher.id, session_id=session_id,
    )

    return {"title": title, "slides": slides}


# ── Student endpoints ──

@student_router.get("/live-interaction/current")
async def get_current_live_interaction(
    db: Annotated[AsyncSession, Depends(get_db)],
    student: Annotated[SessionStudent, Depends(get_current_student)],
):
    li = (await db.execute(
        select(LiveInteraction)
        .where(LiveInteraction.session_id == student.session_id)
        .where(LiveInteraction.status == "ACTIVE")
        .order_by(LiveInteraction.created_at.desc())
        .limit(1)
    )).scalar_one_or_none()

    if not li:
        return {"active": False}

    slides = li.slides_json or []
    current_slide = slides[li.current_slide_index] if 0 <= li.current_slide_index < len(slides) else None

    already_answered = (await db.execute(
        select(LiveInteractionResponse)
        .where(LiveInteractionResponse.live_interaction_id == li.id)
        .where(LiveInteractionResponse.slide_index == li.current_slide_index)
        .where(LiveInteractionResponse.student_id == student.id)
    )).scalar_one_or_none() is not None

    rc = await _count_responses(db, li.id, li.current_slide_index)
    sc = await _count_students(db, student.session_id)

    return {
        "active": True,
        "live_interaction_id": str(li.id),
        "title": li.title,
        "current_slide_index": li.current_slide_index,
        "total_slides": len(slides),
        "current_slide": current_slide,
        "current_slide_started_at": li.current_slide_started_at.isoformat() if li.current_slide_started_at else None,
        "already_answered": already_answered,
        "response_count": rc,
        "total_students": sc,
    }


@student_router.post("/live-interaction/answer")
async def submit_answer(
    body: AnswerSubmit,
    db: Annotated[AsyncSession, Depends(get_db)],
    student: Annotated[SessionStudent, Depends(get_current_student)],
):
    li = (await db.execute(
        select(LiveInteraction)
        .where(LiveInteraction.id == UUID(body.live_interaction_id))
        .where(LiveInteraction.session_id == student.session_id)
        .where(LiveInteraction.status == "ACTIVE")
    )).scalar_one_or_none()

    if not li:
        raise HTTPException(404, "No active live interaction found")
    if li.current_slide_index != body.slide_index:
        raise HTTPException(400, "Slide index mismatch — teacher may have advanced")

    existing = (await db.execute(
        select(LiveInteractionResponse)
        .where(LiveInteractionResponse.live_interaction_id == li.id)
        .where(LiveInteractionResponse.slide_index == body.slide_index)
        .where(LiveInteractionResponse.student_id == student.id)
    )).scalar_one_or_none()

    if existing:
        raise HTTPException(400, "Already answered this slide")

    db.add(LiveInteractionResponse(
        live_interaction_id=li.id,
        slide_index=body.slide_index,
        student_id=student.id,
        response_json=body.response,
    ))
    await db.commit()

    rc = await _count_responses(db, li.id, body.slide_index)
    sc = await _count_students(db, student.session_id)

    await sio.emit(
        "live_interaction_answer_count",
        {
            "live_interaction_id": str(li.id),
            "slide_index": body.slide_index,
            "response_count": rc,
            "total_students": sc,
            "all_answered": rc >= max(sc, 1),
        },
        room=f"session:{li.session_id}",
    )

    return {"success": True, "response_count": rc}
