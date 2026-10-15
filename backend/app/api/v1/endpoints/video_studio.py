"""Video Studio (admin only, testing): educational mini-documentaries via Runware."""
import uuid
from typing import Annotated, Optional

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_admin
from app.core.config import settings
from app.core.database import get_db
from app.models.user import User
from app.models.video_project import VideoProject
from app.services import video_studio as studio
from app.services.document_processor import document_processor
from app.services.storage_service import storage_service

router = APIRouter()

Admin = Annotated[User, Depends(get_current_admin)]
Db = Annotated[AsyncSession, Depends(get_db)]


class ProjectCreate(BaseModel):
    title: str = Field(default="Nuovo video", max_length=200)
    source_text: str = ""
    brief: Optional[str] = None
    style_key: str = "flat_2d"
    aspect: str = "16:9"
    language: str = "it"
    target_shots: int = Field(default=6, ge=2, le=studio.MAX_SHOTS)


class ProjectUpdate(BaseModel):
    title: Optional[str] = Field(default=None, max_length=200)
    source_text: Optional[str] = None
    brief: Optional[str] = None
    style_key: Optional[str] = None
    aspect: Optional[str] = None
    language: Optional[str] = None
    target_shots: Optional[int] = Field(default=None, ge=2, le=studio.MAX_SHOTS)


class ScriptUpdate(BaseModel):
    script: dict


class ShotSelection(BaseModel):
    shots: Optional[list[int]] = None


def _serialize(p: VideoProject, full: bool = True) -> dict:
    out = {
        "id": str(p.id), "title": p.title, "style_key": p.style_key, "aspect": p.aspect,
        "language": p.language, "target_shots": int(p.target_shots or 6), "status": p.status,
        "phase_label": p.phase_label, "has_final": bool(p.final_key), "cost_usd": round(p.cost_usd or 0, 4),
        "error": p.error, "running": studio.is_running(p.id),
        "updated_at": p.updated_at.isoformat() if p.updated_at else None,
    }
    shots = (p.script or {}).get("shots", [])
    thumb = next((f"key_{x['n']}.jpg" for x in shots if x.get("keyframe_key")), None)
    out.update(thumbnail=thumb, shot_count=len(shots))
    if full:
        out.update(source_text=p.source_text, brief=p.brief, script=p.script or {})
    return out


async def _get(db: AsyncSession, project_id: uuid.UUID, admin: User) -> VideoProject:
    project = await db.get(VideoProject, project_id)
    if not project or project.owner_id != admin.id:
        raise HTTPException(status_code=404, detail="Progetto non trovato")
    return project


def _require_key() -> None:
    if not settings.OPENAI_API_KEY:
        raise HTTPException(status_code=503, detail="OPENAI_API_KEY non configurata nel file .env")


def _require_idle(project: VideoProject) -> None:
    if studio.is_running(project.id):
        raise HTTPException(status_code=409, detail="Operazione già in corso su questo progetto")


@router.get("/config")
async def get_config(_: Admin):
    return {
        "configured": bool(settings.OPENAI_API_KEY),
        "image_model": settings.OPENAI_IMAGE_MODEL,
        "image_cost_usd": studio.IMAGE_COST_EST_USD,
        "shot_seconds": studio.SHOT_SECONDS,
        "styles": [{"key": k, "label": v["label"]} for k, v in studio.STYLES.items()],
        "aspects": list(studio.ASPECTS.keys()),
    }


@router.get("/projects")
async def list_projects(admin: Admin, db: Db):
    rows = (await db.execute(
        select(VideoProject).where(VideoProject.owner_id == admin.id).order_by(VideoProject.updated_at.desc())
    )).scalars().all()
    return [_serialize(p, full=False) for p in rows]


@router.post("/projects")
async def create_project(body: ProjectCreate, admin: Admin, db: Db):
    if body.style_key not in studio.STYLES or body.aspect not in studio.ASPECTS:
        raise HTTPException(status_code=400, detail="Stile o formato non valido")
    project = VideoProject(owner_id=admin.id, script={}, **body.model_dump())
    db.add(project)
    await db.commit()
    await db.refresh(project)
    return _serialize(project)


@router.get("/projects/{project_id}")
async def get_project(project_id: uuid.UUID, admin: Admin, db: Db):
    return _serialize(await _get(db, project_id, admin))


@router.patch("/projects/{project_id}")
async def update_project(project_id: uuid.UUID, body: ProjectUpdate, admin: Admin, db: Db):
    project = await _get(db, project_id, admin)
    _require_idle(project)
    for key, value in body.model_dump(exclude_none=True).items():
        if key == "style_key" and value not in studio.STYLES:
            raise HTTPException(status_code=400, detail="Stile non valido")
        if key == "aspect" and value not in studio.ASPECTS:
            raise HTTPException(status_code=400, detail="Formato non valido")
        setattr(project, key, value)
    await db.commit()
    await db.refresh(project)
    return _serialize(project)


@router.delete("/projects/{project_id}")
async def delete_project(project_id: uuid.UUID, admin: Admin, db: Db):
    project = await _get(db, project_id, admin)
    _require_idle(project)
    await db.delete(project)
    await db.commit()
    return {"ok": True}


@router.post("/extract-text")
async def extract_text(_: Admin, file: UploadFile = File(...)):
    data = await file.read()
    if len(data) > 20 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="File troppo grande (max 20 MB)")
    steps: list[str] = []
    text, *_rest = await document_processor._extract_content(
        data, file.filename or "document", file.content_type or "", steps
    )
    if not (text or "").strip():
        raise HTTPException(status_code=422, detail="Nessun testo estratto dal file")
    return {"text": text, "filename": file.filename}


@router.post("/projects/{project_id}/script")
async def generate_script(project_id: uuid.UUID, admin: Admin, db: Db):
    project = await _get(db, project_id, admin)
    _require_idle(project)
    if len((project.source_text or "").strip()) < 40:
        raise HTTPException(status_code=400, detail="Servono almeno 40 caratteri di testo sorgente")
    try:
        script = await studio.generate_script(project)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"Generazione script fallita: {exc}")
    project.script = script
    project.status = "script_ready"
    project.error = None
    project.final_key = None
    if project.title in ("Nuovo video", ""):
        project.title = script["title"][:200]
    await db.commit()
    await db.refresh(project)
    return _serialize(project)


@router.put("/projects/{project_id}/script")
async def update_script(project_id: uuid.UUID, body: ScriptUpdate, admin: Admin, db: Db):
    project = await _get(db, project_id, admin)
    _require_idle(project)
    old = {s["n"]: s for s in (project.script or {}).get("shots", [])}
    incoming = body.script
    shots = incoming.get("shots") or []
    if not shots or len(shots) > studio.MAX_SHOTS:
        raise HTTPException(status_code=400, detail=f"Servono da 1 a {studio.MAX_SHOTS} shot")
    for i, shot in enumerate(shots, start=1):
        prev = old.get(shot.get("n"), {})
        edited = any(shot.get(k) != prev.get(k) for k in ("visual", "entities"))
        shot["n"] = i
        if prev and not edited:
            for k in ("keyframe_key", "keyframe_ver", "video_key", "video_ver", "cost", "status"):
                if k in prev:
                    shot.setdefault(k, prev[k])
        else:
            shot["status"] = "pending"
            for k in ("keyframe_key", "keyframe_ver", "video_key", "video_ver"):
                shot.pop(k, None)
    # keep entity sheets the client could not know about
    sheets = {e["id"]: e for e in (project.script or {}).get("entities", [])}
    for e in incoming.get("entities", []):
        prev = sheets.get(e.get("id"))
        if prev and prev.get("description") == e.get("description"):
            e.setdefault("sheet_key", prev.get("sheet_key"))
            e.setdefault("sheet_ver", prev.get("sheet_ver"))
    project.script = incoming
    project.final_key = None
    if project.status in ("done", "storyboard_ready", "failed"):
        project.status = "script_ready" if not any(s.get("keyframe_key") for s in shots) else "storyboard_ready"
    await db.commit()
    await db.refresh(project)
    return _serialize(project)


@router.post("/projects/{project_id}/storyboard")
async def start_storyboard(project_id: uuid.UUID, body: ShotSelection, admin: Admin, db: Db):
    _require_key()
    project = await _get(db, project_id, admin)
    _require_idle(project)
    if not (project.script or {}).get("shots"):
        raise HTTPException(status_code=400, detail="Genera prima lo script")
    project.status, project.error = "storyboarding", None
    await db.commit()
    await db.refresh(project)
    shots = body.shots
    studio.launch(project.id, lambda pid: studio.run_storyboard(pid, shots))
    return _serialize(project)


@router.post("/projects/{project_id}/render")
async def start_render(project_id: uuid.UUID, body: ShotSelection, admin: Admin, db: Db):
    project = await _get(db, project_id, admin)
    _require_idle(project)
    if not any(s.get("keyframe_key") for s in (project.script or {}).get("shots", [])):
        raise HTTPException(status_code=400, detail="Genera prima lo storyboard")
    project.status, project.error = "rendering", None
    await db.commit()
    await db.refresh(project)
    shots = body.shots
    studio.launch(project.id, lambda pid: studio.run_animatic(pid, shots))
    return _serialize(project)


@router.post("/projects/{project_id}/assemble")
async def start_assemble(project_id: uuid.UUID, admin: Admin, db: Db):
    project = await _get(db, project_id, admin)
    _require_idle(project)
    project.status, project.error = "rendering", None
    await db.commit()
    await db.refresh(project)
    studio.launch(project.id, studio.run_assemble)
    return _serialize(project)


@router.get("/projects/{project_id}/files/{name}")
async def get_file(project_id: uuid.UUID, name: str, admin: Admin, db: Db):
    await _get(db, project_id, admin)
    allowed = (name == "final.mp4" or (name.startswith(("shot_", "key_", "sheet_")) and name.endswith((".mp4", ".jpg"))))
    if not allowed or "/" in name or ".." in name:
        raise HTTPException(status_code=404, detail="File non trovato")
    key = f"video-studio/{project_id}/{name}"
    try:
        data = storage_service.download_file(key)
    except Exception:
        raise HTTPException(status_code=404, detail="File non trovato")
    return Response(
        content=data,
        media_type="video/mp4" if name.endswith(".mp4") else "image/jpeg",
        headers={"Cache-Control": "private, max-age=60"},
    )
