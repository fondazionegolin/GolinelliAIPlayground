import copy
import json
import logging
import os
from datetime import datetime, timedelta, timezone
from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile, status
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_student, get_current_teacher
from app.core.database import get_db
from app.core.security import create_student_join_token, generate_join_code
from app.core.permissions import teacher_can_access_session
from app.models.live_interaction import LiveEscapeParticipant, LiveInteraction, LiveInteractionResponse
from app.models.session import Session, SessionStudent
from app.models.teacherbot import Teacherbot
from app.models.tenant import Tenant
from app.models.user import User
from app.realtime.gateway import sio
from app.services.credit_service import credit_service
from app.services.document_processor import document_processor
from app.services.json_extract import extract_json
from app.services.llm_service import llm_service
from app.services.teacherbot_escape_room import answers_match, generate_plan, judge_semantic_answer, validate_plan

teacher_router = APIRouter()
student_router = APIRouter()
public_router = APIRouter()
logger = logging.getLogger(__name__)

REPORTS_DIR = os.environ.get("LIVE_REPORTS_DIR", "/app/live_interaction_reports")

SLIDE_TYPES = ("mcq", "wordwall", "opinion", "feedback")

SLIDE_TYPE_DESCRIPTIONS = """- mcq: domanda a risposta multipla. Campi: question (string), options (array di 2-6 stringhe brevi), correct_option (indice intero dell'opzione corretta, o null se non applicabile).
- wordwall: nuvola di parole. Campi: prompt (string, invito a rispondere con una parola/breve espressione).
- opinion: opinione libera in una frase. Campi: prompt (string).
- feedback: feedback rapido (sentiment positivo/neutro/negativo). Campi: prompt (string, es. "Come hai trovato questa attività?")."""

REFERENCE_MAX_CHARS = 12000
PUBLIC_LIVE_CODE_LENGTH = 6


# ── Pydantic schemas ──

class LiveInteractionCreate(BaseModel):
    session_id: str
    title: str
    slides_json: list[dict] = []


class LiveInteractionUpdate(BaseModel):
    title: str | None = None
    slides_json: list[dict] | None = None


class LiveInteractionDuplicate(BaseModel):
    target_session_id: UUID
    title: str | None = None


class LiveEscapeCreate(BaseModel):
    session_id: str
    teacherbot_id: str
    preview_only: bool = False
    title: str | None = None
    narrative_intro: str | None = None
    mission: str | None = None
    challenges: list[dict] | None = None


class EscapeAnswerSubmit(BaseModel):
    live_interaction_id: str
    value: str


class PublicLiveJoin(BaseModel):
    nickname: str


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

def _duplicate_as_draft(
    source: LiveInteraction,
    target_session_id: UUID,
    teacher_id: UUID,
    title: str | None = None,
) -> LiveInteraction:
    """Copy reusable content while deliberately dropping audience-specific state."""
    return LiveInteraction(
        session_id=target_session_id,
        created_by=teacher_id,
        title=(title or source.title).strip() or source.title,
        interaction_type=source.interaction_type,
        teacherbot_id=source.teacherbot_id,
        slides_json=copy.deepcopy(source.slides_json or []),
        escape_config_json=copy.deepcopy(source.escape_config_json),
        status="DRAFT",
        current_slide_index=0,
        public_enabled=False,
        public_token=None,
    )


def _public_code_needs_rotation(interaction: LiveInteraction) -> bool:
    return (
        not interaction.public_enabled
        or not interaction.public_token
        or len(interaction.public_token) != PUBLIC_LIVE_CODE_LENGTH
    )


def _disable_public_access(interaction: LiveInteraction) -> None:
    interaction.public_enabled = False
    interaction.public_token = None


async def _broadcast_state(session_id: str, li: LiveInteraction, response_count: int, total_students: int):
    if li.interaction_type == "escape_room":
        config = li.escape_config_json or {}
        await sio.emit(
            "live_interaction_state",
            {
                "live_interaction_id": str(li.id),
                "title": li.title,
                "interaction_type": "escape_room",
                "status": li.status,
                "total_steps": len(li.slides_json or []),
                "narrative_intro": config.get("narrative_intro"),
                "mission": config.get("mission"),
                "started_at": li.started_at.isoformat() if li.started_at else None,
                "response_count": response_count,
                "total_students": total_students,
            },
            room=f"session:{session_id}",
        )
        return
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
        if li.interaction_type == "escape_room":
            participants = (await db.execute(
                select(LiveEscapeParticipant, SessionStudent.nickname)
                .join(SessionStudent, LiveEscapeParticipant.student_id == SessionStudent.id)
                .where(LiveEscapeParticipant.live_interaction_id == li.id)
            )).all()
            report = {
                "live_interaction_id": str(li.id),
                "title": li.title,
                "session_id": str(li.session_id),
                "status": li.status,
                "interaction_type": "escape_room",
                "challenges": li.slides_json or [],
                "participants": [
                    {
                        "student_nickname": nickname,
                        "current_step": participant.current_step,
                        "attempts": participant.attempts,
                        "answers": participant.answers_json or [],
                        "started_at": participant.started_at.isoformat(),
                        "completed_at": participant.completed_at.isoformat() if participant.completed_at else None,
                    }
                    for participant, nickname in participants
                ],
                "exported_at": datetime.now(timezone.utc).isoformat(),
            }
            os.makedirs(REPORTS_DIR, exist_ok=True)
            safe_title = "".join(c for c in li.title if c.isalnum() or c in (" ", "-", "_")).strip()[:50]
            filename = f"{li.session_id}_{li.id}_{safe_title}.json"
            with open(os.path.join(REPORTS_DIR, filename), "w", encoding="utf-8") as f:
                json.dump(report, f, ensure_ascii=False, indent=2)
            return

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


def _public_escape_state(li: LiveInteraction, participant: LiveEscapeParticipant) -> dict:
    challenges = li.slides_json or []
    step = min(participant.current_step, len(challenges))
    challenge = None
    if li.status == "ACTIVE" and step < len(challenges):
        raw = challenges[step]
        challenge = {
            "number": step + 1,
            "false_statement": raw.get("false_statement", ""),
            "prompt": raw.get("prompt", "Individua l’informazione falsa e inserisci la correzione."),
        }
    return {
        "active": li.status == "ACTIVE",
        "status": li.status,
        "interaction_type": "escape_room",
        "live_interaction_id": str(li.id),
        "title": li.title,
        "narrative_intro": (li.escape_config_json or {}).get("narrative_intro"),
        "mission": (li.escape_config_json or {}).get("mission"),
        "current_step": step,
        "total_steps": len(challenges),
        "attempts": participant.attempts,
        "current_challenge": challenge,
        "inventory": participant.inventory_json or [],
        "started_at": participant.started_at.isoformat(),
        "completed_at": participant.completed_at.isoformat() if participant.completed_at else None,
    }


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
            "interaction_type": li.interaction_type,
            "teacherbot_id": str(li.teacherbot_id) if li.teacherbot_id else None,
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


@teacher_router.post("/live-interactions/from-teacherbot", status_code=201)
async def create_live_escape_room(
    body: LiveEscapeCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
    teacher: Annotated[User, Depends(get_current_teacher)],
):
    session_id = UUID(body.session_id)
    if not await teacher_can_access_session(db, teacher, session_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Session not found")
    bot = (await db.execute(
        select(Teacherbot)
        .where(Teacherbot.id == UUID(body.teacherbot_id))
        .where(Teacherbot.teacher_id == teacher.id)
    )).scalar_one_or_none()
    if not bot or not bot.enable_escape_room:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Escape-room Teacherbot not found")
    session_obj = (await db.execute(select(Session).where(Session.id == session_id))).scalar_one()
    llm_response = None
    if body.challenges is not None:
        if not body.challenges:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Aggiungi almeno un indizio.")
        try:
            plan = validate_plan({
                "title": body.title,
                "narrative_intro": body.narrative_intro,
                "mission": body.mission,
                "challenges": body.challenges,
            }, len(body.challenges))
        except ValueError as exc:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc)) from exc
    else:
        allowed = await credit_service.check_availability(
            db,
            teacher.tenant_id,
            estimated_cost=0.0005,
            teacher_id=teacher.id,
            class_id=session_obj.class_id,
            session_id=session_obj.id,
        )
        if not allowed:
            raise HTTPException(status.HTTP_402_PAYMENT_REQUIRED, "Credit limit exceeded for this session/class.")
        try:
            plan, llm_response = await generate_plan(bot.system_prompt, bot.llm_provider, bot.llm_model)
        except Exception as exc:
            logger.exception("Live escape-room generation failed for teacherbot %s", bot.id)
            raise HTTPException(status.HTTP_502_BAD_GATEWAY, "Non è stato possibile preparare l'escape room.") from exc

    if llm_response is not None:
        cost = credit_service.calculate_cost_for_model(
            llm_response.provider, llm_response.model,
            llm_response.prompt_tokens, llm_response.completion_tokens,
        )
        await credit_service.track_usage(
            db, teacher.tenant_id, llm_response.provider, llm_response.model, cost,
            {
                "type": "live_escape_room_generation",
                "bot_id": str(bot.id),
                "prompt_tokens": llm_response.prompt_tokens,
                "completion_tokens": llm_response.completion_tokens,
            },
            teacher_id=teacher.id,
            class_id=session_obj.class_id,
            session_id=session_obj.id,
        )

    if body.preview_only:
        await db.commit()
        return {"preview": True, **plan}

    li = LiveInteraction(
        session_id=session_id,
        created_by=teacher.id,
        title=plan["title"] or bot.name,
        interaction_type="escape_room",
        teacherbot_id=bot.id,
        slides_json=plan["challenges"],
        escape_config_json={
            "version": plan.get("version", 3),
            "narrative_intro": plan.get("narrative_intro"),
            "mission": plan.get("mission"),
        },
    )
    db.add(li)
    await db.commit()
    await db.refresh(li)
    return {"id": str(li.id), "title": li.title, "status": li.status, "interaction_type": li.interaction_type}


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
        "interaction_type": li.interaction_type,
        "teacherbot_id": str(li.teacherbot_id) if li.teacherbot_id else None,
        "status": li.status,
        "slides_json": li.slides_json,
        "current_slide_index": li.current_slide_index,
        "current_slide_started_at": li.current_slide_started_at.isoformat() if li.current_slide_started_at else None,
        "started_at": li.started_at.isoformat() if li.started_at else None,
        "ended_at": li.ended_at.isoformat() if li.ended_at else None,
        "escape_config": li.escape_config_json,
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


@teacher_router.post("/live-interactions/{interaction_id}/duplicate", status_code=201)
async def duplicate_live_interaction(
    interaction_id: UUID,
    body: LiveInteractionDuplicate,
    db: Annotated[AsyncSession, Depends(get_db)],
    teacher: Annotated[User, Depends(get_current_teacher)],
):
    """Clone any live activity as a clean draft for another audience."""
    source = (await db.execute(
        select(LiveInteraction).where(LiveInteraction.id == interaction_id)
    )).scalar_one_or_none()
    if not source or not await teacher_can_access_session(db, teacher, source.session_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Live interaction not found")

    target_session_id = body.target_session_id
    if not await teacher_can_access_session(db, teacher, target_session_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Target session not found")

    duplicate = _duplicate_as_draft(source, target_session_id, teacher.id, body.title)
    db.add(duplicate)
    await db.commit()
    await db.refresh(duplicate)
    return {
        "id": str(duplicate.id),
        "title": duplicate.title,
        "status": duplicate.status,
        "interaction_type": duplicate.interaction_type,
        "session_id": str(duplicate.session_id),
    }


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


@teacher_router.post("/live-interactions/{interaction_id}/public-link")
async def enable_public_live_link(
    interaction_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    teacher: Annotated[User, Depends(get_current_teacher)],
):
    li = (await db.execute(select(LiveInteraction).where(LiveInteraction.id == interaction_id))).scalar_one_or_none()
    if not li or not await teacher_can_access_session(db, teacher, li.session_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Live interaction not found")
    if li.status == "CLOSED":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Non puoi condividere una sessione conclusa")
    # The public token doubles as a short-lived, human-readable Live code.
    # Preserve it while the link is enabled so reopening the share dialog does
    # not invalidate an already projected QR; rotate it after revocation.
    if _public_code_needs_rotation(li):
        while True:
            candidate = generate_join_code(PUBLIC_LIVE_CODE_LENGTH)
            collision = await db.scalar(
                select(func.count()).select_from(LiveInteraction).where(LiveInteraction.public_token == candidate)
            )
            if not collision:
                li.public_token = candidate
                break
    li.public_enabled = True
    await db.commit()
    return {
        "token": li.public_token,
        "access_code": li.public_token,
        "title": li.title,
        "status": li.status,
    }


@teacher_router.delete("/live-interactions/{interaction_id}/public-link")
async def disable_public_live_link(
    interaction_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    teacher: Annotated[User, Depends(get_current_teacher)],
):
    li = (await db.execute(select(LiveInteraction).where(LiveInteraction.id == interaction_id))).scalar_one_or_none()
    if not li or not await teacher_can_access_session(db, teacher, li.session_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Live interaction not found")
    _disable_public_access(li)
    await db.commit()
    return {"disabled": True, "code_invalidated": True}


async def _get_public_live(db: AsyncSession, token: str) -> tuple[LiveInteraction, Session]:
    li = (await db.execute(
        select(LiveInteraction)
        .where(LiveInteraction.public_token == token)
        .where(LiveInteraction.public_enabled.is_(True))
        .where(LiveInteraction.status != "CLOSED")
    )).scalar_one_or_none()
    if not li:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Link non valido o revocato")
    session_obj = (await db.execute(select(Session).where(Session.id == li.session_id))).scalar_one()
    return li, session_obj


@public_router.get("/live/{token}")
async def get_public_live_info(
    token: str,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    li, session_obj = await _get_public_live(db, token)
    return {
        "title": li.title,
        "live_interaction_id": str(li.id),
        "interaction_type": li.interaction_type,
        "status": li.status,
        "access_code": li.public_token,
        "session_id": str(session_obj.id),
        "session_title": session_obj.title,
    }


@public_router.post("/live/{token}/join")
async def join_public_live(
    token: str,
    body: PublicLiveJoin,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    li, session_obj = await _get_public_live(db, token)
    if li.status == "CLOSED":
        raise HTTPException(status.HTTP_410_GONE, "Questa sessione Live è terminata")
    nickname = " ".join(body.nickname.strip().split())
    if not nickname:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Inserisci un nickname")
    if len(nickname) > 20:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Il nickname può contenere al massimo 20 caratteri")
    existing = (await db.execute(
        select(SessionStudent.id)
        .where(SessionStudent.session_id == session_obj.id)
        .where(func.lower(SessionStudent.nickname) == nickname.lower())
        .limit(1)
    )).scalar_one_or_none()
    if existing:
        raise HTTPException(status.HTTP_409_CONFLICT, "Nickname già in uso: scegline un altro")

    tenant = (await db.execute(select(Tenant).where(Tenant.id == session_obj.tenant_id))).scalar_one_or_none()
    max_students = getattr(tenant, "max_students_per_class", 30) if tenant else 30
    current_students = (await db.scalar(
        select(func.count()).select_from(SessionStudent).where(SessionStudent.session_id == session_obj.id)
    )) or 0
    if current_students >= max_students:
        raise HTTPException(status.HTTP_403_FORBIDDEN, f"Sessione piena (max {max_students} partecipanti)")

    student = SessionStudent(
        tenant_id=session_obj.tenant_id,
        session_id=session_obj.id,
        nickname=nickname,
        join_token="pending",
        password_hash=None,
        last_seen_at=datetime.now(timezone.utc),
    )
    db.add(student)
    await db.flush()
    join_token = create_student_join_token(
        str(session_obj.id), str(student.id), nickname,
        extra_claims={"public_live_id": str(li.id)},
        expires_delta=timedelta(hours=8),
    )
    student.join_token = join_token
    await db.commit()
    return {
        "join_token": join_token,
        "student_id": str(student.id),
        "session_id": str(session_obj.id),
        "session_title": session_obj.title,
        "nickname": nickname,
        "live_interaction_id": str(li.id),
    }


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
        raise HTTPException(400, "No slides or escape-room clues defined")

    li.status = "ACTIVE"
    li.current_slide_index = 0
    li.current_slide_started_at = datetime.now(timezone.utc)
    li.started_at = datetime.now(timezone.utc)
    li.ended_at = None
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
    if li.interaction_type == "escape_room":
        raise HTTPException(400, "Gli studenti avanzano autonomamente nell'escape room")

    slides = li.slides_json or []
    next_index = li.current_slide_index + 1

    if next_index >= len(slides):
        li.status = "CLOSED"
        li.ended_at = datetime.now(timezone.utc)
        _disable_public_access(li)
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
    li.ended_at = datetime.now(timezone.utc)
    _disable_public_access(li)
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

    if li.interaction_type == "escape_room":
        participants = (await db.execute(
            select(LiveEscapeParticipant, SessionStudent.nickname)
            .join(SessionStudent, LiveEscapeParticipant.student_id == SessionStudent.id)
            .where(LiveEscapeParticipant.live_interaction_id == interaction_id)
            .order_by(LiveEscapeParticipant.completed_at.asc().nullslast(), LiveEscapeParticipant.started_at.asc())
        )).all()
        leaderboard = []
        for participant, nickname in participants:
            end_time = participant.completed_at or li.ended_at or datetime.now(timezone.utc)
            duration_seconds = max(0, int((end_time - participant.started_at).total_seconds()))
            leaderboard.append({
                "student_id": str(participant.student_id),
                "student_nickname": nickname,
                "current_step": participant.current_step,
                "total_steps": len(li.slides_json or []),
                "attempts": participant.attempts,
                "answers": participant.answers_json or [],
                "inventory": participant.inventory_json or [],
                "started_at": participant.started_at.isoformat(),
                "completed_at": participant.completed_at.isoformat() if participant.completed_at else None,
                "duration_seconds": duration_seconds,
                "completed": participant.completed_at is not None,
            })
        leaderboard.sort(key=lambda item: (not item["completed"], item["duration_seconds"]))
        for index, item in enumerate((entry for entry in leaderboard if entry["completed"]), start=1):
            item["rank"] = index
        return {
            "live_interaction_id": str(li.id),
            "interaction_type": "escape_room",
            "title": li.title,
            "session_id": str(li.session_id),
            "status": li.status,
            "total_steps": len(li.slides_json or []),
            "challenges": [
                {
                    "false_statement": challenge.get("false_statement", ""),
                    "prompt": challenge.get("prompt", ""),
                    "accepted_answers": challenge.get("accepted_answers") or [],
                }
                for challenge in (li.slides_json or [])
            ],
            "started_at": li.started_at.isoformat() if li.started_at else None,
            "ended_at": li.ended_at.isoformat() if li.ended_at else None,
            "total_students": await _count_students(db, li.session_id),
            "participants": leaderboard,
        }

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
    interaction_id: UUID | None = Query(default=None),
):
    query = (
        select(LiveInteraction)
        .where(LiveInteraction.session_id == student.session_id)
        .where(LiveInteraction.status == "ACTIVE")
    )
    if interaction_id is not None:
        query = query.where(LiveInteraction.id == interaction_id)
    li = (await db.execute(query.order_by(LiveInteraction.created_at.desc()).limit(1))).scalar_one_or_none()

    if not li:
        return {"active": False}

    if li.interaction_type == "escape_room":
        participant = (await db.execute(
            select(LiveEscapeParticipant)
            .where(LiveEscapeParticipant.live_interaction_id == li.id)
            .where(LiveEscapeParticipant.student_id == student.id)
        )).scalar_one_or_none()
        if not participant:
            participant = LiveEscapeParticipant(
                live_interaction_id=li.id,
                student_id=student.id,
                started_at=datetime.now(timezone.utc),
                inventory_json=[],
            )
            db.add(participant)
            await db.commit()
            await db.refresh(participant)
            await sio.emit(
                "live_escape_progress",
                {"live_interaction_id": str(li.id), "event": "joined", "student_id": str(student.id)},
                room=f"session:{li.session_id}",
            )
        return _public_escape_state(li, participant)

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


@student_router.post("/live-interaction/escape-answer")
async def submit_escape_answer(
    body: EscapeAnswerSubmit,
    db: Annotated[AsyncSession, Depends(get_db)],
    student: Annotated[SessionStudent, Depends(get_current_student)],
):
    li = (await db.execute(
        select(LiveInteraction)
        .where(LiveInteraction.id == UUID(body.live_interaction_id))
        .where(LiveInteraction.session_id == student.session_id)
        .where(LiveInteraction.status == "ACTIVE")
        .where(LiveInteraction.interaction_type == "escape_room")
    )).scalar_one_or_none()
    if not li:
        raise HTTPException(404, "No active escape room found")
    participant = (await db.execute(
        select(LiveEscapeParticipant)
        .where(LiveEscapeParticipant.live_interaction_id == li.id)
        .where(LiveEscapeParticipant.student_id == student.id)
        .with_for_update()
    )).scalar_one_or_none()
    if not participant:
        raise HTTPException(409, "Apri prima la sessione live")
    challenges = li.slides_json or []
    if participant.completed_at or participant.current_step >= len(challenges):
        return {**_public_escape_state(li, participant), "correct": True, "message": "Escape room già completata."}

    challenge = challenges[participant.current_step]
    submitted = body.value.strip()
    if not submitted:
        raise HTTPException(422, "Inserisci una correzione")
    is_correct = answers_match(submitted, [str(value) for value in challenge.get("accepted_answers") or []])
    judge_response = None
    session_obj = None
    if not is_correct and li.teacherbot_id:
        bot = (await db.execute(select(Teacherbot).where(Teacherbot.id == li.teacherbot_id))).scalar_one_or_none()
        session_obj = (await db.execute(select(Session).where(Session.id == li.session_id))).scalar_one()
        if bot:
            allowed = await credit_service.check_availability(
                db, student.tenant_id, estimated_cost=0.0001,
                teacher_id=li.created_by, class_id=session_obj.class_id,
                session_id=li.session_id, student_id=student.id,
            )
            if allowed:
                try:
                    is_correct, judge_response = await judge_semantic_answer(
                        challenge, submitted, bot.llm_provider, bot.llm_model
                    )
                except Exception:
                    pass

    participant.answers_json = [
        *(participant.answers_json or []),
        {
            "step_index": participant.current_step,
            "value": submitted,
            "correct": is_correct,
            "submitted_at": datetime.now(timezone.utc).isoformat(),
        },
    ]
    participant.attempts += 1
    achievement = None
    if is_correct:
        achievement = challenge.get("achievement") or {}
        participant.inventory_json = [*(participant.inventory_json or []), achievement]
        participant.current_step += 1
        if participant.current_step >= len(challenges):
            participant.completed_at = datetime.now(timezone.utc)

    if judge_response is not None and session_obj is not None:
        cost = credit_service.calculate_cost_for_model(
            judge_response.provider, judge_response.model,
            judge_response.prompt_tokens, judge_response.completion_tokens,
        )
        await credit_service.track_usage(
            db, student.tenant_id, judge_response.provider, judge_response.model, cost,
            {
                "type": "live_escape_room_validation",
                "live_interaction_id": str(li.id),
                "prompt_tokens": judge_response.prompt_tokens,
                "completion_tokens": judge_response.completion_tokens,
            },
            teacher_id=li.created_by, class_id=session_obj.class_id,
            session_id=li.session_id, student_id=student.id,
        )

    total_students = await _count_students(db, li.session_id)
    completed_count = (await db.scalar(
        select(func.count()).select_from(LiveEscapeParticipant)
        .where(LiveEscapeParticipant.live_interaction_id == li.id)
        .where(LiveEscapeParticipant.completed_at.is_not(None))
    )) or 0
    if participant.completed_at:
        completed_count = max(completed_count, 1)
    all_completed = total_students > 0 and completed_count >= total_students
    if all_completed:
        li.status = "CLOSED"
        li.ended_at = datetime.now(timezone.utc)
        _disable_public_access(li)
    await db.commit()
    await db.refresh(participant)

    await sio.emit(
        "live_escape_progress",
        {
            "live_interaction_id": str(li.id),
            "event": "completed" if participant.completed_at else "progress",
            "student_id": str(student.id),
            "current_step": participant.current_step,
            "total_steps": len(challenges),
            "completed_count": completed_count,
            "total_students": total_students,
            "all_completed": all_completed,
        },
        room=f"session:{li.session_id}",
    )
    if all_completed:
        await _save_report(db, li)
        await sio.emit(
            "live_interaction_state",
            {"live_interaction_id": str(li.id), "interaction_type": "escape_room", "status": "CLOSED"},
            room=f"session:{li.session_id}",
        )

    response = _public_escape_state(li, participant)
    response.update({
        "correct": is_correct,
        "achievement": achievement if is_correct else None,
        "message": (
            "Missione completata!" if participant.completed_at
            else "Oggetto aggiunto all'inventario." if is_correct
            else "La correzione non risolve l'indizio. Riprova."
        ),
    })
    return response
