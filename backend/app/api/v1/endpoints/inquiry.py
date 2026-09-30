"""Teacherbot "inquiry" mode: investigative NPC interview over realtime voice.

The browser keeps a direct WebRTC link to the realtime model, but every student turn is routed
through ``POST /turn`` first: the backend classifies the intent, updates the game state (trust,
pressure, unlocked clues) and returns the stage direction the browser injects before the NPC
speaks. Secrets and locked clues therefore never leave the server.
"""
from datetime import datetime, timezone
from typing import Annotated, Literal, Optional
from uuid import UUID
import logging
import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import StudentOrTeacher, get_current_teacher, get_student_or_teacher
from app.api.v1.endpoints.llm import (
    RealtimeHistoryMessage,
    _load_voice_teacherbot,
    _mint_realtime_voice_secret,
    _voice_mode_wrapper,
    safe_track_usage,
)
from app.core.config import settings
from app.core.database import get_db
from app.models.inquiry import InquirySession
from app.models.session import Class, Session
from app.models.teacherbot import Teacherbot
from app.models.user import User
from app.schemas.teacherbot import InquiryConfig
from app.services import inquiry_service as svc
from app.services.credit_service import credit_service

logger = logging.getLogger(__name__)
router = APIRouter()

MAX_ATTEMPTS = 3
MAX_TRANSCRIPT_TURNS = 400


# ── helpers ──────────────────────────────────────────────────────────────────

def _load_config(bot: Teacherbot) -> InquiryConfig:
    if not bot.enable_inquiry or not bot.inquiry_config:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "La modalità inquiry non è abilitata per questo assistente")
    try:
        cfg = InquiryConfig.model_validate(bot.inquiry_config)
    except Exception:  # noqa: BLE001
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Configurazione inquiry non valida")
    multi = len(cfg.suspects) > 1
    if multi and not cfg.final_question.strip():
        cfg.final_question = "Chi è il colpevole e perché?"
    if not cfg.clues or not cfg.truth.strip() or not cfg.final_question.strip():
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Configurazione inquiry incompleta (verità, indizi, domanda finale)")
    if multi and svc.culprit_of(cfg) is None:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Indica quale sospettato è il colpevole")
    return cfg


def cfg_first_id(cfg: InquiryConfig) -> str:
    return svc.cast(cfg)[0].id


def _multi(cfg: InquiryConfig) -> bool:
    return len(cfg.suspects) > 1


def _require_suspect(cfg: InquiryConfig, suspect_id: Optional[str]):
    suspect = svc.resolve_suspect(cfg, suspect_id)
    if suspect is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Sospettato non trovato")
    return suspect


def _suspect_levels(sess: InquirySession, suspect_id: str) -> tuple[int, int]:
    st = (sess.suspect_state or {}).get(suspect_id) or {}
    return int(st.get("trust", 0)), int(st.get("pressure", 0))


def _actor_id(auth: StudentOrTeacher) -> UUID:
    return auth.teacher.id if auth.is_teacher else auth.student.id


async def _credit_scope(db: AsyncSession, auth: StudentOrTeacher) -> dict:
    if auth.is_teacher:
        return {"teacher_id": auth.teacher.id}
    student = auth.student
    row = (await db.execute(
        select(Session, Class).join(Class, Session.class_id == Class.id).where(Session.id == student.session_id)
    )).first()
    if not row:
        return {"session_id": student.session_id, "student_id": student.id}
    session_obj, class_obj = row
    return {
        "teacher_id": class_obj.teacher_id, "class_id": class_obj.id,
        "session_id": session_obj.id, "student_id": student.id,
    }


async def _require_credits(db: AsyncSession, tenant_id: UUID, scope: dict) -> None:
    if not await credit_service.check_availability(db, tenant_id, estimated_cost=0.0005, **scope):
        raise HTTPException(status.HTTP_402_PAYMENT_REQUIRED, "Crediti AI esauriti. Attendi il rinnovo del plafond.")


async def _track(db: AsyncSession, tenant_id: UUID, scope: dict, resp, usage_type: str, sess: InquirySession) -> None:
    if resp is None:
        return
    cost = credit_service.calculate_cost_for_model(resp.provider, resp.model, resp.prompt_tokens, resp.completion_tokens)
    await safe_track_usage(
        db, tenant_id, resp.provider, resp.model, cost,
        {
            "type": usage_type, "inquiry_session_id": str(sess.id),
            "prompt_tokens": resp.prompt_tokens, "completion_tokens": resp.completion_tokens,
        },
        **scope, context=usage_type,
    )


async def _load_session(db: AsyncSession, auth: StudentOrTeacher, session_id: UUID) -> tuple[InquirySession, Teacherbot]:
    sess = (await db.execute(select(InquirySession).where(InquirySession.id == session_id))).scalar_one_or_none()
    if not sess:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Sessione inquiry non trovata")
    if auth.is_teacher and sess.teacher_id != auth.teacher.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Sessione inquiry non trovata")
    if auth.is_student and sess.student_id != auth.student.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Sessione inquiry non trovata")
    bot = (await db.execute(select(Teacherbot).where(Teacherbot.id == sess.teacherbot_id))).scalar_one_or_none()
    if not bot:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Assistente non trovato")
    return sess, bot


def _public_state(sess: InquirySession, cfg: InquiryConfig) -> dict:
    unlocked = list(sess.unlocked_clue_ids or [])
    by_id = {c.id: c for c in cfg.clues}
    people = svc.cast(cfg)
    names = {sp.id: (sp.name or sp.id) for sp in people}
    clue_counts: dict[str, int] = {}
    for cid in unlocked:
        c = by_id.get(cid)
        if c and c.suspect_id:
            clue_counts[c.suspect_id] = clue_counts.get(c.suspect_id, 0) + 1
    return {
        "session_id": str(sess.id),
        "status": sess.status,
        "multi": _multi(cfg),
        "suspects": [
            {"id": sp.id, "name": sp.name, "role": sp.role, "avatar_url": sp.avatar_url, "voice": sp.voice,
             "clues_found": clue_counts.get(sp.id, 0),
             "clues_total": sum(1 for c in cfg.clues if c.suspect_id == sp.id)}
            for sp in people
        ],
        "accused_suspect_id": sess.accused_suspect_id,
        "npc_name": people[0].name,
        "case_title": cfg.case_title,
        "case_brief": cfg.case_brief,
        "final_question": cfg.final_question,
        "min_clues": cfg.min_clues,
        "total_clues": len(cfg.clues),
        "unlocked_clues": [
            {"id": cid, "text": by_id[cid].text, "tier": by_id[cid].tier,
             "suspect_id": by_id[cid].suspect_id, "suspect_name": names.get(by_id[cid].suspect_id or "", None)}
            for cid in unlocked if cid in by_id
        ],
        "can_answer": len(unlocked) >= cfg.min_clues and sess.status == "active",
        "attempts": sess.attempts,
        "max_attempts": MAX_ATTEMPTS,
        "verdict": sess.verdict,
    }


def _append_transcript(sess: InquirySession, turns: list[dict]) -> None:
    now = datetime.now(timezone.utc).isoformat()
    merged = list(sess.transcript or []) + [{**t, "ts": now} for t in turns]
    sess.transcript = merged[-MAX_TRANSCRIPT_TURNS:]


# ── schemas ──────────────────────────────────────────────────────────────────

class InquirySessionRequest(BaseModel):
    teacherbot_id: UUID
    language: str = "it"
    voice: Optional[str] = None
    restart: bool = False
    suspect_id: Optional[str] = None


class InquiryTurnRequest(BaseModel):
    text: str = Field(min_length=1, max_length=2000)
    language: str = "it"
    suspect_id: Optional[str] = None


class InquiryLogTurn(BaseModel):
    role: Literal["user", "assistant"]
    text: str = Field(max_length=4000)


class InquiryLogRequest(BaseModel):
    turns: list[InquiryLogTurn] = Field(max_length=20)
    suspect_id: Optional[str] = None


class InquiryAnswerRequest(BaseModel):
    answer: str = Field(min_length=1, max_length=2000)
    accused_suspect_id: Optional[str] = None


class InquiryGenerateRequest(BaseModel):
    case_title: str = Field(default="", max_length=200)
    case_brief: str = Field(default="", max_length=2000)
    truth: str = Field(default="", max_length=6000)
    count: int = Field(default=3, ge=2, le=6)
    language: str = "it"
    existing_names: list[str] = Field(default_factory=list, max_length=8)


# ── endpoints ────────────────────────────────────────────────────────────────

@router.post("/session")
async def create_inquiry_session(
    request: InquirySessionRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    auth: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
):
    """Start (or resume) an inquiry and mint the realtime secret for the NPC."""
    if not settings.OPENAI_API_KEY:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "L'interazione vocale non è configurata")

    bot = await _load_voice_teacherbot(db, auth, request.teacherbot_id)
    cfg = _load_config(bot)

    actor_col = InquirySession.teacher_id if auth.is_teacher else InquirySession.student_id
    sess = (await db.execute(
        select(InquirySession)
        .where(InquirySession.teacherbot_id == bot.id)
        .where(actor_col == _actor_id(auth))
        .order_by(InquirySession.created_at.desc())
        .limit(1)
    )).scalar_one_or_none()

    if sess is not None and (request.restart or sess.status != "active"):
        sess = None
    if sess is None:
        sess = InquirySession(
            teacherbot_id=bot.id,
            teacher_id=auth.teacher.id if auth.is_teacher else None,
            student_id=auth.student.id if auth.is_student else None,
            unlocked_clue_ids=[], transcript=[], trust=0, pressure=0, turn_count=0, attempts=0, status="active",
        )
        db.add(sess)
        await db.flush()

    suspect = _require_suspect(cfg, request.suspect_id)
    history = [
        RealtimeHistoryMessage(role=t["role"], content=t["text"])
        for t in (sess.transcript or [])
        if t.get("role") in ("user", "assistant") and t.get("text")
        and (t.get("suspect") or cfg_first_id(cfg)) == suspect.id
    ][-24:]
    instructions = _voice_mode_wrapper(
        svc.build_npc_instructions(cfg, suspect, request.language), request.language, "natural", "normal",
        exam_mode=False, history=history,
        opening=None if history else svc.build_opening(cfg, request.language),
    )
    minted = await _mint_realtime_voice_secret(
        instructions, suspect.voice or request.voice, str(_actor_id(auth)),
        model=settings.OPENAI_REALTIME_INQUIRY_MODEL or settings.OPENAI_REALTIME_MODEL,
    )
    await db.commit()
    return {**minted, "resumed": bool(history), "suspect_id": suspect.id, "state": _public_state(sess, cfg)}


@router.post("/{session_id}/turn")
async def inquiry_turn(
    session_id: UUID,
    request: InquiryTurnRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    auth: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
):
    """Classify the student's spoken turn and return the stage direction for the NPC's reply."""
    sess, bot = await _load_session(db, auth, session_id)
    cfg = _load_config(bot)
    if sess.status != "active":
        raise HTTPException(status.HTTP_409_CONFLICT, "L'intervista è già conclusa")

    scope = await _credit_scope(db, auth)
    await _require_credits(db, bot.tenant_id, scope)

    suspect = _require_suspect(cfg, request.suspect_id)
    unlocked = list(sess.unlocked_clue_ids or [])
    recent = [
        t for t in (sess.transcript or [])
        if t.get("role") in ("user", "assistant") and (t.get("suspect") or cfg_first_id(cfg)) == suspect.id
    ]
    trust, pressure = _suspect_levels(sess, suspect.id)
    intent, targets, resp = await svc.classify_turn(cfg, suspect, request.text, recent, unlocked)
    decision = svc.apply_turn(cfg, suspect, intent, targets, trust, pressure, unlocked)

    sess.suspect_state = {**(sess.suspect_state or {}), suspect.id: {"trust": decision.trust, "pressure": decision.pressure}}
    sess.trust, sess.pressure = decision.trust, decision.pressure
    sess.unlocked_clue_ids = decision.unlocked_ids
    sess.turn_count = (sess.turn_count or 0) + 1
    _append_transcript(sess, [{"role": "user", "text": request.text, "flag": decision.flag, "intent": intent, "suspect": suspect.id}])
    await _track(db, bot.tenant_id, scope, resp, "inquiry_classify", sess)
    await db.commit()

    out = {
        "stage_direction": svc.build_stage_direction(cfg, decision, request.language),
        "flag": decision.flag,
        "intensity": decision.intensity,
        "new_clue": next(
            ({"id": c.id, "text": c.text, "tier": c.tier} for c in cfg.clues if c.id == decision.unlocked_clue_id), None
        ),
        "state": _public_state(sess, cfg),
    }
    if auth.is_teacher:  # test view: expose the reasoning
        out["debug"] = {"intent": intent, "targets": targets, "trust": decision.trust, "pressure": decision.pressure}
    return out


@router.post("/{session_id}/log")
async def inquiry_log(
    session_id: UUID,
    request: InquiryLogRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    auth: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
):
    """Persist NPC turns (and any user turns not logged via /turn) into the transcript."""
    sess, _bot = await _load_session(db, auth, session_id)
    turns = [
        {"role": t.role, "text": t.text.strip(), "suspect": request.suspect_id}
        for t in request.turns if t.text.strip()
    ]
    if turns:
        _append_transcript(sess, turns)
        await db.commit()
    return {"ok": True}


@router.post("/{session_id}/answer")
async def inquiry_answer(
    session_id: UUID,
    request: InquiryAnswerRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    auth: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
):
    """Submit the final answer. Allowed only after the minimum number of clues has been found."""
    sess, bot = await _load_session(db, auth, session_id)
    cfg = _load_config(bot)
    if sess.status != "active":
        raise HTTPException(status.HTTP_409_CONFLICT, "L'intervista è già conclusa")
    if len(sess.unlocked_clue_ids or []) < cfg.min_clues:
        raise HTTPException(
            status.HTTP_409_CONFLICT, f"Trova almeno {cfg.min_clues} indizi prima di rispondere"
        )

    accused = None
    if _multi(cfg):
        accused = svc.resolve_suspect(cfg, request.accused_suspect_id) if request.accused_suspect_id else None
        if accused is None:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Scegli chi accusare")
    scope = await _credit_scope(db, auth)
    await _require_credits(db, bot.tenant_id, scope)
    try:
        correct, score, feedback, resp = await svc.grade_answer(cfg, request.answer.strip(), accused)
    except Exception as exc:  # noqa: BLE001
        logger.error("Inquiry grading failed: %s", exc)
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "Impossibile valutare la risposta, riprova")

    sess.attempts = (sess.attempts or 0) + 1
    sess.final_answer = request.answer.strip()
    sess.accused_suspect_id = accused.id if accused else None
    if correct:
        sess.status = "solved"
    elif sess.attempts >= MAX_ATTEMPTS:
        sess.status = "failed"
    sess.verdict = {"correct": correct, "score": score, "feedback": feedback}
    await _track(db, bot.tenant_id, scope, resp, "inquiry_grade", sess)
    await db.commit()

    out = {**_public_state(sess, cfg), "correct": correct, "score": score, "feedback": feedback}
    if sess.status in ("solved", "failed"):
        out["correct_answer"] = cfg.correct_answer
        out["truth"] = cfg.truth
        culprit = svc.culprit_of(cfg)
        if culprit:
            out["culprit"] = {"id": culprit.id, "name": culprit.name}
    return out


@router.post("/generate-suspects")
async def generate_suspects(
    request: InquiryGenerateRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    teacher: Annotated[User, Depends(get_current_teacher)],
):
    """Teacher helper: draft a cast of suspects and assigned clues from the case description."""
    if not (request.case_title.strip() or request.case_brief.strip()):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Scrivi almeno titolo o briefing del caso")
    scope = {"teacher_id": teacher.id}
    await _require_credits(db, teacher.tenant_id, scope)
    try:
        data, resp = await svc.generate_cast(
            request.case_title, request.case_brief, request.truth, request.count, request.language, request.existing_names,
        )
    except Exception as exc:  # noqa: BLE001
        logger.error("Inquiry cast generation failed: %s", exc)
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "Generazione non riuscita, riprova")
    cost = credit_service.calculate_cost_for_model(resp.provider, resp.model, resp.prompt_tokens, resp.completion_tokens)
    await safe_track_usage(
        db, teacher.tenant_id, resp.provider, resp.model, cost,
        {"type": "inquiry_generate_cast", "prompt_tokens": resp.prompt_tokens, "completion_tokens": resp.completion_tokens},
        **scope, context="inquiry_generate_cast",
    )
    suspects = []
    for i, sp in enumerate((data.get("suspects") or [])[: request.count]):
        if not isinstance(sp, dict):
            continue
        suspects.append({
            "id": f"s{i + 1}", "name": str(sp.get("name") or "")[:80], "role": str(sp.get("role") or "")[:200],
            "personality": str(sp.get("personality") or "")[:800], "knowledge": str(sp.get("knowledge") or "")[:3000],
            "is_culprit": bool(sp.get("is_culprit")), "avatar_prompt": str(sp.get("avatar_prompt") or "")[:500],
            "avatar_url": None, "voice": None,
        })
    if not suspects:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "Generazione non riuscita, riprova")
    if not any(sp["is_culprit"] for sp in suspects):
        suspects[0]["is_culprit"] = True
    seen_culprit = False
    for sp in suspects:
        if sp["is_culprit"] and seen_culprit:
            sp["is_culprit"] = False
        seen_culprit = seen_culprit or sp["is_culprit"]
    ids = {sp["id"] for sp in suspects}
    clues = []
    for i, c in enumerate((data.get("clues") or [])[:20]):
        if not isinstance(c, dict) or not str(c.get("text") or "").strip():
            continue
        sid = c.get("suspect_id") if c.get("suspect_id") in ids else None
        try:
            tier = max(1, min(3, int(c.get("tier", 1))))
        except (TypeError, ValueError):
            tier = 1
        clues.append({"id": f"c{i + 1}", "suspect_id": sid, "text": str(c["text"])[:1000], "tier": tier,
                      "unlock_hint": str(c.get("unlock_hint") or "")[:400]})
    return {"suspects": suspects, "clues": clues, "correct_answer": str(data.get("correct_answer") or "")[:1200],
            "truth": str(data.get("truth") or "")[:6000]}


@router.get("/overview/{teacherbot_id}")
async def inquiry_overview(
    teacherbot_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    auth: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
):
    """Public cast + progress, without opening a session (drives the suspect gallery before connecting)."""
    bot = await _load_voice_teacherbot(db, auth, teacherbot_id)
    cfg = _load_config(bot)
    actor_col = InquirySession.teacher_id if auth.is_teacher else InquirySession.student_id
    sess = (await db.execute(
        select(InquirySession)
        .where(InquirySession.teacherbot_id == bot.id)
        .where(actor_col == _actor_id(auth))
        .order_by(InquirySession.created_at.desc())
        .limit(1)
    )).scalar_one_or_none()
    if sess is None or sess.status != "active":
        sess = InquirySession(
            id=uuid.uuid4(), teacherbot_id=bot.id, status="active", unlocked_clue_ids=[], suspect_state={},
            transcript=[], attempts=0, trust=0, pressure=0, turn_count=0,
        )
    return _public_state(sess, cfg)


@router.get("/{session_id}")
async def get_inquiry_state(
    session_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    auth: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
):
    sess, bot = await _load_session(db, auth, session_id)
    return _public_state(sess, _load_config(bot))


@router.get("/bots/{teacherbot_id}/sessions")
async def list_inquiry_sessions(
    teacherbot_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    teacher: Annotated[User, Depends(get_current_teacher)],
):
    """Teacher review: every run on one of their inquiry bots, with transcripts."""
    bot = (await db.execute(
        select(Teacherbot).where(Teacherbot.id == teacherbot_id).where(Teacherbot.teacher_id == teacher.id)
    )).scalar_one_or_none()
    if not bot:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Assistente non trovato")

    from app.models.session import SessionStudent

    rows = (await db.execute(
        select(InquirySession, SessionStudent.nickname)
        .outerjoin(SessionStudent, SessionStudent.id == InquirySession.student_id)
        .where(InquirySession.teacherbot_id == bot.id)
        .order_by(InquirySession.created_at.desc())
        .limit(200)
    )).all()
    return [
        {
            "id": str(s.id),
            "student": nickname if s.student_id else None,
            "is_test": s.teacher_id is not None,
            "status": s.status,
            "clues_found": len(s.unlocked_clue_ids or []),
            "attempts": s.attempts,
            "verdict": s.verdict,
            "final_answer": s.final_answer,
            "trust": s.trust,
            "pressure": s.pressure,
            "accused_suspect_id": s.accused_suspect_id,
            "transcript": s.transcript or [],
            "created_at": s.created_at.isoformat() if s.created_at else None,
        }
        for s, nickname in rows
    ]
