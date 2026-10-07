"""ML Lab: library of image-classifier projects, per teacher or per student account."""
import json
from typing import Annotated, Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import desc, func, select
from sqlalchemy.orm import defer
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import StudentOrTeacher, get_student_or_teacher
from app.core.database import get_db
from app.models.ml_image_project import MLImageProject

router = APIRouter()
Auth = Annotated[StudentOrTeacher, Depends(get_student_or_teacher)]
Db = Annotated[AsyncSession, Depends(get_db)]

MAX_PROJECTS_PER_OWNER = 60
MAX_DATA_BYTES = 8 * 1024 * 1024
MAX_CLASSES = 10


class ProjectPayload(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    engine: str = Field(default="mobilenet-v1-050/1", max_length=40)
    accuracy: float | None = Field(default=None, ge=0, le=1)
    summary: list[dict[str, Any]] = Field(default_factory=list)  # [{id, name, color, count, thumbs: [dataURL…]}]
    data: dict[str, Any] = Field(default_factory=dict)
    session_id: UUID | None = None


def _owner_filter(auth: StudentOrTeacher):
    return MLImageProject.owner_student_id == auth.student.id if auth.is_student else MLImageProject.owner_teacher_id == auth.teacher.id


def _tenant(auth: StudentOrTeacher):
    return auth.student.tenant_id if auth.is_student else auth.teacher.tenant_id


def _summary(project: MLImageProject, has_model: bool | None = None) -> dict:
    return {"id": str(project.id), "has_model": bool(has_model) if has_model is not None else bool((project.data_json or {}).get("model")), "name": project.name, "engine": project.engine, "class_count": project.class_count, "sample_count": project.sample_count,
            "accuracy": project.accuracy, "classes": project.summary_json, "created_at": project.created_at, "updated_at": project.updated_at}


def _validate(payload: ProjectPayload) -> tuple[int, int]:
    classes = payload.data.get("classes") or []
    if not isinstance(classes, list) or len(classes) > MAX_CLASSES:
        raise HTTPException(status_code=422, detail=f"Al massimo {MAX_CLASSES} classi")
    if len(json.dumps(payload.data, separators=(",", ":"))) > MAX_DATA_BYTES:
        raise HTTPException(status_code=413, detail="Progetto troppo grande: riduci il numero di campioni")
    samples = sum(len((c or {}).get("samples") or []) for c in classes)
    return len(classes), samples


async def _get_owned(db: AsyncSession, auth: StudentOrTeacher, project_id: UUID) -> MLImageProject:
    project = (await db.execute(select(MLImageProject).where(MLImageProject.id == project_id, _owner_filter(auth)))).scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=404, detail="Progetto non trovato")
    return project


@router.get("/projects")
async def list_projects(auth: Auth, db: Db) -> dict:
    # The (large) sample data is never loaded for the list: only the card summary and whether a trained model exists.
    rows = (await db.execute(
        select(MLImageProject, MLImageProject.data_json.has_key("model").label("has_model"))
        .options(defer(MLImageProject.data_json)).where(_owner_filter(auth)).order_by(desc(MLImageProject.updated_at))
    )).all()
    return {"projects": [_summary(project, has_model) for project, has_model in rows]}


@router.get("/models/{project_id}")
async def get_runtime_model(project_id: UUID, auth: Auth, db: Db) -> dict:
    """Compact trained model (no samples) for apps built in the Vibe Lab. Readable by anyone of the same organisation,
    so a shared app keeps working for the people it is shared with."""
    project = (await db.execute(select(MLImageProject).where(MLImageProject.id == project_id, MLImageProject.tenant_id == _tenant(auth)))).scalar_one_or_none()
    model = (project.data_json or {}).get("model") if project else None
    if not project:
        raise HTTPException(status_code=404, detail="Modello non trovato")
    if not model:
        raise HTTPException(status_code=409, detail="Il progetto non ha ancora un modello addestrato: aggiungi esempi nel Lab ML")
    return {"id": str(project.id), "name": project.name, **model}


@router.post("/projects", status_code=201)
async def create_project(payload: ProjectPayload, auth: Auth, db: Db) -> dict:
    count = (await db.execute(select(func.count(MLImageProject.id)).where(_owner_filter(auth)))).scalar_one()
    if count >= MAX_PROJECTS_PER_OWNER:
        raise HTTPException(status_code=409, detail="Libreria piena: elimina qualche progetto")
    classes, samples = _validate(payload)
    project = MLImageProject(
        tenant_id=_tenant(auth), owner_teacher_id=auth.teacher.id if auth.is_teacher else None, owner_student_id=auth.student.id if auth.is_student else None,
        session_id=payload.session_id or (auth.student.session_id if auth.is_student else None), name=payload.name.strip(), engine=payload.engine,
        class_count=classes, sample_count=samples, accuracy=payload.accuracy, summary_json=payload.summary, data_json=payload.data)
    db.add(project)
    await db.commit()
    await db.refresh(project)
    return _summary(project)


@router.get("/projects/{project_id}")
async def get_project(project_id: UUID, auth: Auth, db: Db) -> dict:
    project = await _get_owned(db, auth, project_id)
    return {**_summary(project), "data": project.data_json}


@router.put("/projects/{project_id}")
async def update_project(project_id: UUID, payload: ProjectPayload, auth: Auth, db: Db) -> dict:
    project = await _get_owned(db, auth, project_id)
    classes, samples = _validate(payload)
    project.name, project.engine, project.accuracy = payload.name.strip(), payload.engine, payload.accuracy
    project.class_count, project.sample_count = classes, samples
    project.summary_json, project.data_json = payload.summary, payload.data
    await db.commit()
    await db.refresh(project)
    return _summary(project)


@router.post("/projects/{project_id}/duplicate", status_code=201)
async def duplicate_project(project_id: UUID, auth: Auth, db: Db) -> dict:
    source = await _get_owned(db, auth, project_id)
    count = (await db.execute(select(func.count(MLImageProject.id)).where(_owner_filter(auth)))).scalar_one()
    if count >= MAX_PROJECTS_PER_OWNER:
        raise HTTPException(status_code=409, detail="Libreria piena: elimina qualche progetto")
    copy = MLImageProject(
        tenant_id=source.tenant_id, owner_teacher_id=source.owner_teacher_id, owner_student_id=source.owner_student_id, session_id=source.session_id,
        name=f"{source.name} (copia)"[:120], engine=source.engine, class_count=source.class_count, sample_count=source.sample_count,
        accuracy=source.accuracy, summary_json=source.summary_json, data_json=source.data_json)
    db.add(copy)
    await db.commit()
    await db.refresh(copy)
    return _summary(copy)


@router.delete("/projects/{project_id}", status_code=204)
async def delete_project(project_id: UUID, auth: Auth, db: Db) -> None:
    await db.delete(await _get_owned(db, auth, project_id))
    await db.commit()
