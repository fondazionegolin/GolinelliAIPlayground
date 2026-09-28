"""3D Lab solid modeler (Tinkercad-like prototype).

Teachers own and edit projects; students own their own projects when the session
enables the `models3d` module. Teacher models shared with a class are readable by its
students and, when enabled, by anyone holding the public link.
"""
import json
import logging
import secrets
import uuid
from datetime import datetime
from typing import Annotated, Any, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import StudentOrTeacher, get_current_student, get_current_teacher, get_student_or_teacher
from app.api.v1.endpoints.llm import safe_track_usage
from app.core.config import settings
from app.core.database import AsyncSessionLocal, get_db
from app.models.invitation import ClassTeacher
from app.models.session import Class, Session, SessionModule, SessionStudent
from app.models.solid_model import SolidModel
from app.models.user import User
from app.services import background_jobs
from app.services.credit_service import credit_service
from app.services.llm_service import llm_service
from app.services.solid_modeler_agent import (
    SYSTEM_PROMPT,
    SceneExecutor,
    build_observation,
    describe_scene,
    initial_user_message,
    parse_step,
    sanitize_scene,
    scene_warnings,
    summarize_actions,
)

logger = logging.getLogger(__name__)

router = APIRouter()

# provider/model pairs the modeler UI may request; anything else falls back to the platform default.
ALLOWED_MODELS = {
    ("anthropic", "claude-sonnet-4-6"),
    ("anthropic", "claude-opus-4-8"),
    ("openai", "gpt-5.2"),
    ("openai", "gpt-5.6-luna"),
}
# Premium model reserved to teachers: student runs are billed to the shared student pool.
STUDENT_BLOCKED_MODELS = {("anthropic", "claude-opus-4-8")}


MODULE_KEY = "models3d"


async def get_modeler_actor(
    actor: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> StudentOrTeacher:
    """Teachers always; students only while their session has the 3D Lab module enabled."""
    if actor.is_student:
        enabled = await db.scalar(
            select(SessionModule.is_enabled).where(
                SessionModule.session_id == actor.student.session_id,
                SessionModule.module_key == MODULE_KEY,
            )
        )
        if not enabled:
            raise HTTPException(status_code=403, detail="Il 3D Lab non è attivo in questa sessione")
    return actor


def _tenant_id(actor: StudentOrTeacher) -> uuid.UUID:
    return actor.student.tenant_id if actor.is_student else actor.teacher.tenant_id


def _credit_scope(actor: StudentOrTeacher) -> dict:
    if actor.is_student:
        return {"session_id": actor.student.session_id, "student_id": actor.student.id}
    return {"teacher_id": actor.teacher.id}


class AgentRequest(BaseModel):
    prompt: str = Field(..., min_length=2, max_length=2000)
    scene: list[dict[str, Any]] = Field(default_factory=list)
    selection: list[str] = Field(default_factory=list)
    provider: Optional[str] = None
    model: Optional[str] = None
    max_steps: int = Field(default=6, ge=2, le=10)
    # Project the run belongs to: the final scene is saved there server-side, so the result is kept
    # even if the user leaves the page before the agent finishes.
    model_id: Optional[uuid.UUID] = None


def _line(payload: dict) -> bytes:
    return (json.dumps(payload, ensure_ascii=False) + "\n").encode("utf-8")


@router.post("/agent")
async def run_modeler_agent(
    body: AgentRequest,
    actor: Annotated[StudentOrTeacher, Depends(get_modeler_actor)],
):
    provider, model = body.provider, body.model
    allowed_models = ALLOWED_MODELS - STUDENT_BLOCKED_MODELS if actor.is_student else ALLOWED_MODELS
    if (provider, model) not in allowed_models:
        provider, model = settings.DEFAULT_LLM_PROVIDER, settings.DEFAULT_LLM_MODEL

    async with AsyncSessionLocal() as db:
        allowed = await credit_service.check_availability(db, _tenant_id(actor), estimated_cost=0.002, **_credit_scope(actor))
    if not allowed:
        raise HTTPException(
            status_code=status.HTTP_402_PAYMENT_REQUIRED,
            detail="Crediti AI esauriti. Attendi il rinnovo del plafond.",
        )

    scene = sanitize_scene(body.scene)
    selection = [s for s in body.selection if any(o["id"] == s for o in scene)]
    max_steps = body.max_steps
    system_prompt = SYSTEM_PROMPT.replace("{max_steps}", str(max_steps))
    model_id = None
    if body.model_id:
        async with AsyncSessionLocal() as db:
            model_id = (await _own_model(db, body.model_id, actor)).id

    async def save_scene(final_scene: list[dict]) -> None:
        if not model_id:
            return
        try:
            async with AsyncSessionLocal() as db:
                model = await db.get(SolidModel, model_id)
                if model is not None:
                    model.scene = final_scene
                    await db.commit()
        except Exception:
            logger.exception("solid modeler agent: could not save scene to model %s", model_id)

    async def stream():
        executor = SceneExecutor(scene)
        messages: list[dict] = [{"role": "user", "content": initial_user_message(body.prompt, scene, selection)}]
        total_cost = 0.0
        final_message = ""
        yield _line({"type": "start", "provider": provider, "model": model, "max_steps": max_steps})
        try:
            for step in range(1, max_steps + 1):
                yield _line({"type": "thinking", "step": step})
                response = await llm_service.generate(
                    messages=messages,
                    system_prompt=system_prompt,
                    provider=provider,
                    model=model,
                    temperature=0.3,
                    max_tokens=6000,
                    allow_web_search=False,
                )
                cost = credit_service.calculate_cost_for_model(
                    response.provider, response.model, response.prompt_tokens, response.completion_tokens,
                )
                total_cost += cost
                async with AsyncSessionLocal() as db:
                    await safe_track_usage(
                        db, _tenant_id(actor), response.provider, response.model, cost,
                        {"type": "solid_modeler_agent", "step": step},
                        **_credit_scope(actor),
                        context="solid_modeler_agent",
                    )
                messages.append({"role": "assistant", "content": response.content})

                try:
                    result = parse_step(response.content)
                except ValueError:
                    obs = "La tua risposta non era JSON valido. Rispondi SOLO con l'oggetto JSON richiesto."
                    messages.append({"role": "user", "content": obs})
                    yield _line({"type": "step", "step": step, "thought": "", "actions": [], "errors": ["Risposta non in JSON, riprovo."], "warnings": [], "scene": executor.scene})
                    continue

                errors = executor.run(result.actions)
                warnings = scene_warnings(executor.scene, final=result.done)
                yield _line({
                    "type": "step",
                    "step": step,
                    "thought": result.thought,
                    "actions": summarize_actions(result.actions),
                    "errors": errors,
                    "warnings": warnings,
                    "scene": executor.scene,
                })

                # Accept "done" only when the step executed cleanly; otherwise let the agent fix it.
                if result.done and not errors and step < max_steps:
                    blocking = [w for w in warnings if "sospeso" in w or "non è raggruppato" in w or "sotto il piatto" in w]
                    if not blocking:
                        final_message = result.message
                        break
                if result.done and step == max_steps:
                    final_message = result.message
                    break
                messages.append({"role": "user", "content": build_observation(executor.scene, errors, warnings, step, max_steps)})
        except Exception as exc:
            logger.exception("solid modeler agent failed")
            yield _line({"type": "error", "detail": f"Errore dell'agente: {exc}", "scene": executor.scene})
            return

        await save_scene(executor.scene)
        yield _line({
            "type": "done",
            "message": final_message or "Ho costruito il modello: controlla le parti e ritocca a mano se serve.",
            "scene": executor.scene,
            "summary": describe_scene(executor.scene),
            "cost": round(total_cost, 6),
            "saved_to_model": bool(model_id),
        })

    def track_progress(event: dict, state: background_jobs.ProgressState) -> None:
        kind = event.get("type")
        if kind == "thinking":
            step = int(event.get("step") or 1)
            state.progress = (step - 1) / max_steps
            state.label = f"Passo {step} di {max_steps}: l'agente progetta il modello"
        elif kind == "step":
            step = int(event.get("step") or 1)
            state.progress = step / max_steps
            thought = str(event.get("thought") or "").strip().splitlines()
            state.label = f"Passo {step} di {max_steps}" + (f": {thought[0][:140]}" if thought else "")
        elif kind == "done":
            state.label = "Modello pronto"
        elif kind == "error":
            state.label = str(event.get("detail") or "Errore")[:200]

    job_id = await background_jobs.start_stream_job(
        background_jobs.JobOwner.from_actor(actor),
        kind="solid_modeler_agent",
        title="Modello 3D con l'AI",
        description=body.prompt,
        route="module:models3d" if actor.is_student else "/teacher/3d-lab",
        resource_id=str(model_id) if model_id else None,
        stream=stream(),
        event_format="ndjson",
        progress_fn=track_progress,
        expected_seconds=25.0 * max_steps,
    )
    return background_jobs.stream_response(job_id, "application/x-ndjson")


# ── Projects (server persistence) ─────────────────────────────────────────

MAX_SCENE_BYTES = 2_000_000
MAX_THUMBNAIL_BYTES = 400_000


class ModelSaveRequest(BaseModel):
    name: Optional[str] = Field(default=None, max_length=160)
    scene: Optional[list[dict[str, Any]]] = None
    thumbnail: Optional[str] = None


class ModelShareRequest(BaseModel):
    class_ids: Optional[list[uuid.UUID]] = None
    public_enabled: Optional[bool] = None
    regenerate_token: bool = False


def _iso(dt: Optional[datetime]) -> Optional[str]:
    return dt.isoformat() if dt else None


def _summary(model: SolidModel) -> dict:
    return {
        "id": str(model.id),
        "name": model.name,
        "thumbnail": model.thumbnail,
        "object_count": len(model.scene or []),
        "shared_class_ids": model.shared_class_ids or [],
        "public_enabled": model.public_enabled,
        "public_token": model.public_token if model.public_enabled else None,
        "created_at": _iso(model.created_at),
        "updated_at": _iso(model.updated_at),
    }


def _detail(model: SolidModel) -> dict:
    return {**_summary(model), "scene": model.scene or []}


def _clean_payload(body: ModelSaveRequest, model: SolidModel) -> None:
    if body.name is not None:
        model.name = body.name.strip()[:160] or "Progetto senza titolo"
    if body.scene is not None:
        scene = sanitize_scene(body.scene)
        if len(json.dumps(scene)) > MAX_SCENE_BYTES:
            raise HTTPException(status_code=413, detail="Scena troppo grande")
        model.scene = scene
    if body.thumbnail is not None:
        thumb = body.thumbnail
        if thumb and (not thumb.startswith("data:image/") or len(thumb) > MAX_THUMBNAIL_BYTES):
            thumb = None
        model.thumbnail = thumb or None


def _owner_filter(actor: StudentOrTeacher):
    if actor.is_student:
        return SolidModel.owner_student_id == actor.student.id
    return SolidModel.owner_id == actor.teacher.id


async def _own_model(db: AsyncSession, model_id: uuid.UUID, actor: StudentOrTeacher) -> SolidModel:
    model = await db.get(SolidModel, model_id)
    owned = model and (
        model.owner_student_id == actor.student.id if actor.is_student else model.owner_id == actor.teacher.id
    )
    if not owned:
        raise HTTPException(status_code=404, detail="Progetto non trovato")
    return model


async def _teacher_class_rows(db: AsyncSession, user: User) -> list[Class]:
    co_taught = select(ClassTeacher.class_id).where(ClassTeacher.teacher_id == user.id)
    result = await db.execute(
        select(Class)
        .where(Class.archived_at.is_(None), or_(Class.teacher_id == user.id, Class.id.in_(co_taught)))
        .order_by(Class.name)
    )
    return list(result.scalars().all())


@router.get("/models")
async def list_models(
    actor: Annotated[StudentOrTeacher, Depends(get_modeler_actor)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    result = await db.execute(
        select(SolidModel).where(_owner_filter(actor)).order_by(SolidModel.updated_at.desc())
    )
    return [_summary(m) for m in result.scalars().all()]


@router.post("/models", status_code=201)
async def create_model(
    body: ModelSaveRequest,
    actor: Annotated[StudentOrTeacher, Depends(get_modeler_actor)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    model = SolidModel(
        tenant_id=_tenant_id(actor),
        owner_id=None if actor.is_student else actor.teacher.id,
        owner_student_id=actor.student.id if actor.is_student else None,
        name="Progetto senza titolo",
        scene=[],
    )
    _clean_payload(body, model)
    db.add(model)
    await db.commit()
    await db.refresh(model)
    return _detail(model)


@router.get("/models/{model_id}")
async def get_model(
    model_id: uuid.UUID,
    actor: Annotated[StudentOrTeacher, Depends(get_modeler_actor)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    return _detail(await _own_model(db, model_id, actor))


@router.put("/models/{model_id}")
async def update_model(
    model_id: uuid.UUID,
    body: ModelSaveRequest,
    actor: Annotated[StudentOrTeacher, Depends(get_modeler_actor)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    model = await _own_model(db, model_id, actor)
    _clean_payload(body, model)
    await db.commit()
    await db.refresh(model)
    return _summary(model)


@router.delete("/models/{model_id}", status_code=204)
async def delete_model(
    model_id: uuid.UUID,
    actor: Annotated[StudentOrTeacher, Depends(get_modeler_actor)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    model = await _own_model(db, model_id, actor)
    await db.delete(model)
    await db.commit()


@router.get("/classes")
async def list_share_classes(
    teacher: Annotated[User, Depends(get_current_teacher)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    return [{"id": str(c.id), "name": c.name, "school_grade": c.school_grade} for c in await _teacher_class_rows(db, teacher)]


@router.put("/models/{model_id}/share")
async def share_model(
    model_id: uuid.UUID,
    body: ModelShareRequest,
    teacher: Annotated[User, Depends(get_current_teacher)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    model = await _own_model(db, model_id, StudentOrTeacher(teacher=teacher))
    if body.class_ids is not None:
        allowed = {c.id for c in await _teacher_class_rows(db, teacher)}
        invalid = [str(cid) for cid in body.class_ids if cid not in allowed]
        if invalid:
            raise HTTPException(status_code=403, detail="Puoi condividere solo con le tue classi")
        model.shared_class_ids = sorted({str(cid) for cid in body.class_ids})
    if body.public_enabled is not None:
        model.public_enabled = body.public_enabled
    if model.public_enabled and (not model.public_token or body.regenerate_token):
        model.public_token = secrets.token_urlsafe(18)
    await db.commit()
    await db.refresh(model)
    return _summary(model)


# ── Read-only access: public link and students of shared classes ─────────

async def _owner_name(db: AsyncSession, model: SolidModel) -> str:
    if model.owner_student_id:
        student = await db.get(SessionStudent, model.owner_student_id)
        return (student.nickname or "") if student else ""
    owner = await db.get(User, model.owner_id) if model.owner_id else None
    if not owner:
        return ""
    return " ".join(p for p in (owner.first_name, owner.last_name) if p) or ""


@router.get("/public/{token}")
async def get_public_model(token: str, db: Annotated[AsyncSession, Depends(get_db)]):
    result = await db.execute(
        select(SolidModel).where(SolidModel.public_token == token, SolidModel.public_enabled.is_(True))
    )
    model = result.scalar_one_or_none()
    if not model:
        raise HTTPException(status_code=404, detail="Link non valido o disattivato")
    return {
        "id": str(model.id),
        "name": model.name,
        "scene": model.scene or [],
        "author": await _owner_name(db, model),
        "updated_at": _iso(model.updated_at),
    }


async def _student_class_id(db: AsyncSession, student: SessionStudent) -> Optional[str]:
    session = await db.get(Session, student.session_id)
    return str(session.class_id) if session else None


@router.get("/student/models")
async def list_student_models(
    student: Annotated[SessionStudent, Depends(get_current_student)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    class_id = await _student_class_id(db, student)
    if not class_id:
        return []
    result = await db.execute(
        select(SolidModel)
        .where(SolidModel.shared_class_ids.contains([class_id]))
        .order_by(SolidModel.updated_at.desc())
    )
    return [
        {"id": str(m.id), "name": m.name, "thumbnail": m.thumbnail, "object_count": len(m.scene or []), "updated_at": _iso(m.updated_at)}
        for m in result.scalars().all()
    ]


@router.get("/student/models/{model_id}")
async def get_student_model(
    model_id: uuid.UUID,
    student: Annotated[SessionStudent, Depends(get_current_student)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    class_id = await _student_class_id(db, student)
    model = await db.get(SolidModel, model_id)
    if not model or not class_id or class_id not in (model.shared_class_ids or []):
        raise HTTPException(status_code=404, detail="Modello non disponibile")
    return {
        "id": str(model.id),
        "name": model.name,
        "scene": model.scene or [],
        "author": await _owner_name(db, model),
        "updated_at": _iso(model.updated_at),
    }
