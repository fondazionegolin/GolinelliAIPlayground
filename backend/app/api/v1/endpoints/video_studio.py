"""Video Studio: source text -> screenplay -> keyframes -> OpenRouter video clips -> ElevenLabs voice -> timeline cut."""
import asyncio
import copy
import time
import uuid
from typing import Annotated, Literal, Optional

import httpx

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_teacher
from app.core.config import settings
from app.core.database import get_db
from app.models.user import User
from app.models.video_project import VideoProject
from app.core.pricing import USD_TO_EUR
from app.services import openrouter, podcasts, voice_lab_billing
from app.services.credit_service import credit_service, to_credits
from app.services import video_studio as studio
from app.services.document_processor import document_processor
from app.services.storage_service import storage_service

router = APIRouter()

Teacher = Annotated[User, Depends(get_current_teacher)]
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
    shots: Optional[list[str]] = None


class VoiceChoice(BaseModel):
    voice_id: str = Field(max_length=120)
    name: str = Field(default="", max_length=120)


class ClipRequest(BaseModel):
    prompt: str = Field(min_length=5, max_length=2000)
    position: int | None = None  # index in the timeline; None = at the end


class RenderSelection(ShotSelection):
    provider: Literal["local", "openrouter"] = "openrouter"
    model: str | None = Field(default=None, max_length=120)
    duration: int | None = Field(default=None, ge=1, le=60)  # None = sized on the narration
    resolution: str | None = Field(default=None, max_length=20)
    voice: VoiceChoice | None = None


def _serialize(p: VideoProject, full: bool = True) -> dict:
    out = {
        "id": str(p.id), "title": p.title, "style_key": p.style_key, "aspect": p.aspect,
        "language": p.language, "target_shots": int(p.target_shots or 6), "status": p.status,
        "phase_label": p.phase_label, "has_final": bool(p.final_key),
        "cost_credits": to_credits((p.cost_usd or 0) * USD_TO_EUR),
        "error": p.error, "running": studio.is_running(p.id),
        "updated_at": p.updated_at.isoformat() if p.updated_at else None,
    }
    shots = (p.script or {}).get("shots", [])
    thumb = next((s["keyframe_key"].rsplit("/", 1)[-1] for s in shots if s.get("keyframe_key")), None)
    out.update(thumbnail=thumb, shot_count=len(shots))
    if full:
        out.update(source_text=p.source_text, brief=p.brief, script=studio.ensure_ids(copy.deepcopy(p.script or {})))
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


async def _require_credits(db: AsyncSession, user: User, usd: float) -> None:
    """Refuse to start a paid step the owner's credit budget cannot cover."""
    if usd > 0 and user.tenant_id and not await credit_service.check_availability(
            db, user.tenant_id, usd * USD_TO_EUR, teacher_id=user.id):
        raise HTTPException(status_code=402, detail="Crediti insufficienti per questa generazione")


def _credits(usd: float) -> float:
    return to_credits(usd * USD_TO_EUR)


@router.get("/config")
async def get_config(_: Teacher):
    return {
        "configured": bool(settings.OPENAI_API_KEY),
        "image_model": settings.OPENAI_IMAGE_MODEL,
        "image_credits": _credits(studio.image_cost_usd()),
        "sheet_credits": _credits(studio.IMAGE_COST_BY_QUALITY["low"]),
        "voice_credits_per_1000_chars": _credits(voice_lab_billing.quote("tts", characters=1000, model=settings.VIDEO_STUDIO_TTS_MODEL)["usd"]),
        "chars_per_second": studio.VOICE_CHARS_PER_SECOND,
        "shot_seconds": studio.SHOT_SECONDS,
        "styles": [{"key": k, "label": v["label"]} for k, v in studio.STYLES.items()],
        "aspects": list(studio.ASPECTS.keys()),
        "transitions": [{"key": k, "label": v} for k, v in studio.TRANSITIONS.items()],
        "openrouter_configured": bool(settings.OPENROUTER_API_KEY),
        "voice_configured": bool(settings.ELEVENLABS_API_KEY),
    }


@router.get("/video-models")
async def list_video_models(_: Teacher):
    """Every OpenRouter model able to animate a still frame, straight from the live catalogue."""
    if not settings.OPENROUTER_API_KEY:
        return []
    try:
        async with httpx.AsyncClient(timeout=25) as client:
            live = await openrouter.video_catalog(client)
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail="Catalogo video OpenRouter non raggiungibile") from exc
    result = []
    for m in live:
        resolutions = m.get("supported_resolutions") or []
        audio = bool(m.get("generate_audio"))
        per_res = {}
        for res in resolutions or [None]:
            usd = openrouter.sku_usd_per_second(m, res, False)
            if usd is not None:
                per_res[res or "default"] = _credits(usd)
        result.append({
            "id": m["id"], "name": m.get("name") or m["id"],
            "supported_durations": sorted(m["supported_durations"]),
            "supported_resolutions": resolutions,
            "supported_aspect_ratios": m.get("supported_aspect_ratios") or [],
            "default_resolution": openrouter.default_resolution(resolutions),
            "credits_per_second": per_res,
            "has_audio": audio,
        })
    result.sort(key=lambda m: min(m["credits_per_second"].values(), default=1e9))
    return result


@router.get("/voices")
async def list_voices(_: Teacher):
    if not settings.ELEVENLABS_API_KEY:
        return []
    voices = await podcasts.list_voices()
    return [{"voice_id": v["voice_id"], "name": v["name"], "preview_url": v.get("preview_url"),
             "labels": v.get("labels") or {}} for v in voices]


async def _reconcile(db: AsyncSession, projects) -> None:
    if any([studio.reconcile_stale(p) for p in projects]):
        await db.commit()


@router.get("/projects")
async def list_projects(admin: Teacher, db: Db):
    rows = (await db.execute(
        select(VideoProject).where(VideoProject.owner_id == admin.id).order_by(VideoProject.updated_at.desc())
    )).scalars().all()
    await _reconcile(db, rows)
    return [_serialize(p, full=False) for p in rows]


@router.post("/projects")
async def create_project(body: ProjectCreate, admin: Teacher, db: Db):
    if body.style_key not in studio.STYLES or body.aspect not in studio.ASPECTS:
        raise HTTPException(status_code=400, detail="Stile o formato non valido")
    project = VideoProject(owner_id=admin.id, script={}, **body.model_dump())
    db.add(project)
    await db.commit()
    await db.refresh(project)
    return _serialize(project)


@router.get("/projects/{project_id}")
async def get_project(project_id: uuid.UUID, admin: Teacher, db: Db):
    project = await _get(db, project_id, admin)
    await _reconcile(db, [project])
    await db.refresh(project)
    return _serialize(project)


@router.patch("/projects/{project_id}")
async def update_project(project_id: uuid.UUID, body: ProjectUpdate, admin: Teacher, db: Db):
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
async def delete_project(project_id: uuid.UUID, admin: Teacher, db: Db):
    project = await _get(db, project_id, admin)
    _require_idle(project)
    await db.delete(project)
    await db.commit()
    return {"ok": True}


@router.post("/extract-text")
async def extract_text(_: Teacher, file: UploadFile = File(...)):
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
async def generate_script(project_id: uuid.UUID, admin: Teacher, db: Db):
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


SERVER_FIELDS = ("keyframe_key", "keyframe_ver", "video_key", "video_ver", "clip_dur", "audio_key", "audio_ver",
                 "audio_dur", "audio_sig", "audio_in", "audio_out", "status", "error", "source", "openrouter_job_id")


@router.put("/projects/{project_id}/script")
async def update_script(project_id: uuid.UUID, body: ScriptUpdate, admin: Teacher, db: Db):
    """Save script + timeline. Order of `shots` is the timeline order; media fields are server-owned."""
    project = await _get(db, project_id, admin)
    _require_idle(project)
    current = studio.ensure_ids(copy.deepcopy(project.script or {}))
    old = {s["id"]: s for s in current.get("shots", [])}
    incoming = body.script
    shots = incoming.get("shots") or []
    if not shots or len(shots) > studio.MAX_TIMELINE:
        raise HTTPException(status_code=400, detail=f"Servono da 1 a {studio.MAX_TIMELINE} clip")
    seen: set[str] = set()
    clean = []
    for i, raw in enumerate(shots, start=1):
        sid = str(raw.get("id") or studio.new_id())
        if sid in seen:
            sid = studio.new_id()
        seen.add(sid)
        source = old.get(raw.get("clone_of") or sid)  # a split clip inherits the media of its parent
        shot = {k: raw.get(k, "") for k in ("title", "narration", "visual", "motion")}
        shot.update(id=sid, n=i, entities=[str(e) for e in raw.get("entities", [])])
        transition = raw.get("transition") if raw.get("transition") in studio.TRANSITIONS else "none"
        if i > 1 and transition != "none":
            try:
                length = float(raw.get("transition_dur") or 0.6)
            except (TypeError, ValueError):
                length = 0.6
            shot["transition"], shot["transition_dur"] = transition, round(max(0.2, min(length, 2.0)), 2)
        if source:
            for k in SERVER_FIELDS:
                if k in source:
                    shot[k] = source[k]
            # A split clip does not repeat its parent's voice-over.
            if raw.get("clone_of") and raw.get("clone_of") != sid:
                for k in ("audio_key", "audio_ver", "audio_dur", "audio_sig", "audio_in", "audio_out"):
                    shot.pop(k, None)
            if source.get("visual") != shot["visual"] or source.get("entities") != shot["entities"]:
                if source.get("source") != "upload" and not raw.get("clone_of"):
                    for k in ("keyframe_key", "keyframe_ver", "video_key", "video_ver", "clip_dur", "openrouter_job_id"):
                        shot.pop(k, None)
                    shot["status"] = "pending"
            if shot.get("audio_key"):  # voice-over track: trims and manual position
                a_dur = float(shot.get("audio_dur") or 0)
                try:
                    a_in = max(0.0, min(float(raw.get("audio_in") or 0), max(a_dur - 0.2, 0)))
                    a_out = max(a_in + 0.2, min(float(raw.get("audio_out") or a_dur), a_dur))
                    shot["audio_in"], shot["audio_out"] = round(a_in, 2), round(a_out, 2)
                    if raw.get("audio_offset") is not None:
                        shot["audio_offset"] = round(max(-60.0, min(float(raw["audio_offset"]), 600.0)), 2)
                except (TypeError, ValueError):
                    pass
            if shot.get("video_key"):
                clip_dur = float(shot.get("clip_dur") or 0)
                if clip_dur:
                    t_in = max(0.0, min(float(raw.get("trim_in") or 0), clip_dur - 0.2))
                    t_out = max(t_in + 0.2, min(float(raw.get("trim_out") or clip_dur), clip_dur + studio.MAX_HOLD))
                    shot["trim_in"], shot["trim_out"] = round(t_in, 2), round(t_out, 2)
        else:
            shot["status"] = "pending"
        clean.append(shot)
    sheets = {e["id"]: e for e in current.get("entities", [])}
    entities = []
    for e in incoming.get("entities", []):
        prev = sheets.get(e.get("id"))
        item = {k: e.get(k, "") for k in ("id", "name", "kind", "description")}
        if prev and prev.get("description") == item["description"]:
            for k in ("sheet_key", "sheet_ver"):
                if k in prev:
                    item[k] = prev[k]
        entities.append(item)
    script = {
        "title": incoming.get("title", current.get("title", "")), "logline": incoming.get("logline", ""),
        "style_bible": incoming.get("style_bible", ""), "entities": entities, "shots": clean,
        # Render configuration and voice are only writable through the validated render endpoint.
        "render_settings": current.get("render_settings", {"provider": "local"}),
    }
    if current.get("voice"):
        script["voice"] = current["voice"]
    if body.script.get("voice"):
        voice = body.script["voice"]
        if isinstance(voice, dict) and voice.get("voice_id"):
            script["voice"] = {"voice_id": str(voice["voice_id"])[:120], "name": str(voice.get("name", ""))[:120]}
    changed = [{k: v for k, v in s.items() if k not in ("n",)} for s in clean] != \
              [{k: v for k, v in s.items() if k not in ("n",)} for s in current.get("shots", [])]
    project.script = script
    if changed:
        project.final_key = None  # the exported film no longer matches the timeline
    if project.status in ("done", "storyboard_ready", "failed"):
        project.status = "script_ready" if not any(s.get("keyframe_key") for s in clean) else "storyboard_ready"
    await db.commit()
    await db.refresh(project)
    return _serialize(project)


@router.post("/projects/{project_id}/storyboard")
async def start_storyboard(project_id: uuid.UUID, body: ShotSelection, admin: Teacher, db: Db):
    _require_key()
    project = await _get(db, project_id, admin)
    _require_idle(project)
    script = studio.ensure_ids(copy.deepcopy(project.script or {}))
    if not script.get("shots"):
        raise HTTPException(status_code=400, detail="Genera prima lo script")
    todo = [s for s in script["shots"] if s.get("source") != "upload"
            and (s["id"] in body.shots if body.shots else not s.get("keyframe_key"))]
    sheets = [e for e in script.get("entities", []) if e["id"] in studio.sheet_entities(script) and not e.get("sheet_key")]
    await _require_credits(db, admin, len(todo) * studio.image_cost_usd() + len(sheets) * studio.IMAGE_COST_BY_QUALITY["low"])
    project.script = script
    project.status, project.error = "storyboarding", None
    await db.commit()
    await db.refresh(project)
    shots = body.shots
    await studio.launch(project.id, lambda pid: studio.run_storyboard(pid, shots), owner=admin,
                        title=f"Immagini: {project.title}", expected_seconds=40 + 25 * len(todo))
    return _serialize(project)


@router.post("/projects/{project_id}/render")
async def start_render(project_id: uuid.UUID, body: RenderSelection, admin: Teacher, db: Db):
    """Clips from the keyframes with the chosen video model, voice-over, then the final cut."""
    project = await _get(db, project_id, admin)
    _require_idle(project)
    script = studio.ensure_ids(copy.deepcopy(project.script or {}))
    shots = script.get("shots", [])
    if not any(s.get("keyframe_key") for s in shots):
        raise HTTPException(status_code=400, detail="Genera prima le immagini")
    render_settings: dict = {"provider": "local"}
    price_per_second = 0.0
    if body.provider == "openrouter":
        if not settings.OPENROUTER_API_KEY:
            raise HTTPException(status_code=503, detail="OPENROUTER_API_KEY non configurata nel file .env")
        try:
            async with httpx.AsyncClient(timeout=25) as client:
                live = next((m for m in await openrouter.video_catalog(client) if m["id"] == body.model), None)
            if not live:
                raise ValueError("Modello video non disponibile su OpenRouter")
            resolution = body.resolution or openrouter.default_resolution(live.get("supported_resolutions"))
            openrouter.validate_video_options(live, body.duration or live["supported_durations"][0], project.aspect, resolution)
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        except httpx.HTTPError as exc:
            raise HTTPException(status_code=502, detail="Catalogo video OpenRouter non raggiungibile") from exc
        render_settings = {"provider": "openrouter", "model": body.model, "duration": body.duration, "resolution": resolution}
        price_per_second = openrouter.sku_usd_per_second(live, resolution, False) or 0.0
    voice = body.voice
    if voice and not settings.ELEVENLABS_API_KEY:
        raise HTTPException(status_code=503, detail="ELEVENLABS_API_KEY non configurata nel file .env")
    if voice and voice.voice_id not in {v["voice_id"] for v in await podcasts.list_voices()}:
        raise HTTPException(status_code=422, detail="Voce non disponibile nell'account ElevenLabs")

    previous = script.get("render_settings", {"provider": "local"})
    if previous != render_settings:
        # Clips from a different model/settings must not be silently reused.
        for shot in shots:
            if shot.get("source") == "upload":
                continue
            for k in ("video_key", "video_ver", "clip_dur", "trim_in", "trim_out", "openrouter_job_id"):
                shot.pop(k, None)
        project.final_key = None
    script["render_settings"] = render_settings
    if voice:
        script["voice"] = {"voice_id": voice.voice_id, "name": voice.name}
    elif "voice" in script and body.provider and body.shots is None:
        script.pop("voice")
    targets = [s for s in shots if s.get("source") != "upload" and s.get("keyframe_key")
               and (s["id"] in body.shots if body.shots else not s.get("video_key"))]
    seconds = sum(render_settings.get("duration") or openrouter.pick_duration([3, 4, 5, 6, 8, 10], studio.estimate_clip_seconds(s.get("narration", ""))) for s in targets)
    chars = sum(len((s.get("narration") or "").strip()) for s in shots if voice and (not body.shots or s["id"] in body.shots))
    voice_usd = voice_lab_billing.quote("tts", characters=chars, model=settings.VIDEO_STUDIO_TTS_MODEL)["usd"] if chars else 0.0
    await _require_credits(db, admin, seconds * price_per_second + voice_usd)
    if body.shots:
        for shot in shots:
            if shot["id"] in body.shots:
                shot.pop("openrouter_job_id", None)
    project.script = script
    project.status, project.error = "rendering", None
    await db.commit()
    await db.refresh(project)
    ids = body.shots
    await studio.launch(project.id, lambda pid: studio.run_render(pid, ids), owner=admin,
                        title=f"Clip e voce: {project.title}", expected_seconds=90 * max(len(targets), 1) + 30,
                        description="Generazione clip, voce narrante e montaggio finale")
    return _serialize(project)


@router.post("/projects/{project_id}/assemble")
async def start_assemble(project_id: uuid.UUID, admin: Teacher, db: Db):
    project = await _get(db, project_id, admin)
    _require_idle(project)
    project.status, project.error = "rendering", None
    await db.commit()
    await db.refresh(project)
    await studio.launch(project.id, studio.run_assemble, owner=admin, title=f"Montaggio: {project.title}", expected_seconds=60)
    return _serialize(project)


@router.post("/projects/{project_id}/clips")
async def upload_clip(project_id: uuid.UUID, admin: Teacher, db: Db, file: UploadFile = File(...),
                      position: int | None = None):
    """Add an uploaded video (from the computer or the Files section) to the end/position of the timeline."""
    project = await _get(db, project_id, admin)
    _require_idle(project)
    script = studio.ensure_ids(copy.deepcopy(project.script or {}))
    shots = script.setdefault("shots", [])
    if len(shots) >= studio.MAX_TIMELINE:
        raise HTTPException(status_code=400, detail=f"Massimo {studio.MAX_TIMELINE} clip nella timeline")
    data = await file.read()
    if len(data) > 300 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="File troppo grande (max 300 MB)")
    if not (file.content_type or "").startswith("video/") and not (file.filename or "").lower().endswith(
            (".mp4", ".mov", ".webm", ".mkv", ".m4v", ".avi")):
        raise HTTPException(status_code=415, detail="Carica un file video (mp4, mov, webm)")
    try:
        video, thumb, duration = await asyncio.to_thread(studio.normalise_upload, data)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=422, detail="Impossibile leggere il video: formato non supportato") from exc
    if duration < 0.3 or duration > 3600:
        raise HTTPException(status_code=422, detail="Durata del video non valida")
    sid = studio.new_id()
    base = f"video-studio/{project.id}"
    await studio._put(f"{base}/shot_{sid}.mp4", video, "video/mp4")
    await studio._put(f"{base}/key_{sid}.jpg", thumb, "image/jpeg")
    ver = int(time.time())
    name = (file.filename or "Clip").rsplit(".", 1)[0][:80]
    shot = {"id": sid, "n": 0, "title": name, "narration": "", "visual": "", "motion": "", "entities": [],
            "source": "upload", "status": "video", "video_key": f"{base}/shot_{sid}.mp4", "video_ver": ver,
            "keyframe_key": f"{base}/key_{sid}.jpg", "keyframe_ver": ver,
            "clip_dur": round(duration, 2), "trim_in": 0.0, "trim_out": round(duration, 2)}
    at = len(shots) if position is None else max(0, min(position, len(shots)))
    shots.insert(at, shot)
    for i, s in enumerate(shots, start=1):
        s["n"] = i
    project.script = script
    project.final_key = None
    if project.status in ("draft", "script_ready"):
        project.status = "script_ready" if not any(s.get("keyframe_key") for s in shots) else "storyboard_ready"
    await db.commit()
    await db.refresh(project)
    return _serialize(project)


@router.post("/projects/{project_id}/clips/generate")
async def generate_clip(project_id: uuid.UUID, body: ClipRequest, admin: Teacher, db: Db):
    """Add one AI-generated clip (image + video + voice) anywhere in the timeline, leaving the other clips untouched."""
    _require_key()
    project = await _get(db, project_id, admin)
    _require_idle(project)
    script = studio.ensure_ids(copy.deepcopy(project.script or {}))
    shots = script.setdefault("shots", [])
    if len(shots) >= studio.MAX_TIMELINE:
        raise HTTPException(status_code=400, detail=f"Massimo {studio.MAX_TIMELINE} clip nella timeline")
    at = len(shots) if body.position is None else max(0, min(body.position, len(shots)))
    settings_ = script.get("render_settings") or {"provider": "local"}
    price = 0.0
    if settings_.get("provider") == "openrouter":
        try:
            async with httpx.AsyncClient(timeout=25) as client:
                live = next((m for m in await openrouter.video_catalog(client) if m["id"] == settings_.get("model")), None)
            if live:
                price = (openrouter.sku_usd_per_second(live, settings_.get("resolution"), False) or 0.0) * float(settings_.get("duration") or studio.SHOT_SECONDS)
        except httpx.HTTPError:
            pass
    voice_usd = voice_lab_billing.quote("tts", characters=180, model=settings.VIDEO_STUDIO_TTS_MODEL)["usd"] if script.get("voice") else 0.0
    await _require_credits(db, admin, studio.image_cost_usd() + price + voice_usd)
    try:
        shot = await studio.draft_shot(project, script, body.prompt, at)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=str(exc) or "Clip non scritta") from exc
    shots.insert(at, shot)
    for i, s in enumerate(shots, start=1):
        s["n"] = i
    project.script = script
    project.final_key = None
    project.status, project.error = "storyboarding", None
    await db.commit()
    await db.refresh(project)
    sid = shot["id"]
    await studio.launch(project.id, lambda pid: studio.run_insert_clip(pid, sid), owner=admin,
                        title=f"Nuova clip: {project.title}", expected_seconds=120,
                        description="Immagine, clip e voce della nuova clip")
    out = _serialize(project)
    out["new_shot_id"] = sid
    return out


@router.get("/projects/{project_id}/files/{name}")
async def get_file(project_id: uuid.UUID, name: str, admin: Teacher, db: Db):
    await _get(db, project_id, admin)
    allowed = (name == "final.mp4" or (name.startswith(("shot_", "key_", "sheet_", "voice_"))
                                       and name.endswith((".mp4", ".jpg", ".mp3"))))
    if not allowed or "/" in name or ".." in name:
        raise HTTPException(status_code=404, detail="File non trovato")
    key = f"video-studio/{project_id}/{name}"
    try:
        data = storage_service.download_file(key)
    except Exception:
        raise HTTPException(status_code=404, detail="File non trovato")
    media = "video/mp4" if name.endswith(".mp4") else "audio/mpeg" if name.endswith(".mp3") else "image/jpeg"
    return Response(content=data, media_type=media, headers={"Cache-Control": "private, max-age=60"})
