"""3D Lab solid modeler (Tinkercad-like prototype).

Editing + AI agent are admin-only for now; shared models are readable by students
of the target classes and, when enabled, by anyone holding the public link.
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

from app.api.deps import get_current_admin, get_current_student
from app.api.v1.endpoints.llm import safe_track_usage
from app.core.config import settings
from app.core.database import AsyncSessionLocal, get_db
from app.models.invitation import ClassTeacher
from app.models.session import Class, Session, SessionStudent
from app.models.solid_model import SolidModel
from app.models.user import User
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


class AgentRequest(BaseModel):
    prompt: str = Field(..., min_length=2, max_length=2000)
    scene: list[dict[str, Any]] = Field(default_factory=list)
    selection: list[str] = Field(default_factory=list)
    provider: Optional[str] = None
    model: Optional[str] = None
    max_steps: int = Field(default=6, ge=2, le=10)


def _line(payload: dict) -> bytes:
    return (json.dumps(payload, ensure_ascii=False) + "\n").encode("utf-8")


@router.post("/agent")
async def run_modeler_agent(
    body: AgentRequest,
    admin: Annotated[User, Depends(get_current_admin)],
):
    provider, model = body.provider, body.model
    if (provider, model) not in ALLOWED_MODELS:
        provider, model = settings.DEFAULT_LLM_PROVIDER, settings.DEFAULT_LLM_MODEL

    async with AsyncSessionLocal() as db:
        allowed = await credit_service.check_availability(db, admin.tenant_id, estimated_cost=0.002, teacher_id=admin.id)
    if not allowed:
        raise HTTPException(
            status_code=status.HTTP_402_PAYMENT_REQUIRED,
            detail="Crediti AI esauriti. Attendi il rinnovo del plafond.",
        )

    scene = sanitize_scene(body.scene)
    selection = [s for s in body.selection if any(o["id"] == s for o in scene)]
    max_steps = body.max_steps
    system_prompt = SYSTEM_PROMPT.replace("{max_steps}", str(max_steps))

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
                        db, admin.tenant_id, response.provider, response.model, cost,
                        {"type": "solid_modeler_agent", "step": step},
                        teacher_id=admin.id,
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

        yield _line({
            "type": "done",
            "message": final_message or "Ho costruito il modello: controlla le parti e ritocca a mano se serve.",
            "scene": executor.scene,
            "summary": describe_scene(executor.scene),
            "cost": round(total_cost, 6),
        })

    return StreamingResponse(
        stream(),
        media_type="application/x-ndjson",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


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


async def _own_model(db: AsyncSession, model_id: uuid.UUID, user: User) -> SolidModel:
    model = await db.get(SolidModel, model_id)
    if not model or model.owner_id != user.id:
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
    admin: Annotated[User, Depends(get_current_admin)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    result = await db.execute(
        select(SolidModel).where(SolidModel.owner_id == admin.id).order_by(SolidModel.updated_at.desc())
    )
    return [_summary(m) for m in result.scalars().all()]


@router.post("/models", status_code=201)
async def create_model(
    body: ModelSaveRequest,
    admin: Annotated[User, Depends(get_current_admin)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    model = SolidModel(tenant_id=admin.tenant_id, owner_id=admin.id, name="Progetto senza titolo", scene=[])
    _clean_payload(body, model)
    db.add(model)
    await db.commit()
    await db.refresh(model)
    return _detail(model)


@router.get("/models/{model_id}")
async def get_model(
    model_id: uuid.UUID,
    admin: Annotated[User, Depends(get_current_admin)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    return _detail(await _own_model(db, model_id, admin))


@router.put("/models/{model_id}")
async def update_model(
    model_id: uuid.UUID,
    body: ModelSaveRequest,
    admin: Annotated[User, Depends(get_current_admin)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    model = await _own_model(db, model_id, admin)
    _clean_payload(body, model)
    await db.commit()
    await db.refresh(model)
    return _summary(model)


@router.delete("/models/{model_id}", status_code=204)
async def delete_model(
    model_id: uuid.UUID,
    admin: Annotated[User, Depends(get_current_admin)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    model = await _own_model(db, model_id, admin)
    await db.delete(model)
    await db.commit()


@router.get("/classes")
async def list_share_classes(
    admin: Annotated[User, Depends(get_current_admin)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    return [{"id": str(c.id), "name": c.name, "school_grade": c.school_grade} for c in await _teacher_class_rows(db, admin)]


@router.put("/models/{model_id}/share")
async def share_model(
    model_id: uuid.UUID,
    body: ModelShareRequest,
    admin: Annotated[User, Depends(get_current_admin)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    model = await _own_model(db, model_id, admin)
    if body.class_ids is not None:
        allowed = {c.id for c in await _teacher_class_rows(db, admin)}
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

async def _owner_name(db: AsyncSession, owner_id: uuid.UUID) -> str:
    owner = await db.get(User, owner_id)
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
        "author": await _owner_name(db, model.owner_id),
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
        "author": await _owner_name(db, model.owner_id),
        "updated_at": _iso(model.updated_at),
    }
