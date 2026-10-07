import asyncio
import logging
from urllib.parse import urlparse
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from typing import Annotated, Optional
import httpx

from app.core.database import get_db
from app.api.deps import StudentOrTeacher, get_student_or_teacher
from app.models.session import Class, Session, SessionModule
from app.services.meshy_service import meshy_service
from app.services import background_jobs
from app.realtime.gateway import sio
from app.services.credit_service import credit_service
from app.core.config import settings
from app.core.pricing import MESHY_CREDIT_EUR
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)

router = APIRouter()

ALLOWED_PROXY_DOMAINS = {"assets.meshy.ai", "cdn.meshy.ai"}
MODULE_KEY = "models3d_ai"  # "AI 3D" session module, separate from the solid-modeler 3D Lab


def _check_key():
    if not settings.MESHY_API_KEY:
        raise HTTPException(status_code=503, detail="3D generation not configured")


async def get_meshy_actor(
    actor: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> StudentOrTeacher:
    """Teachers always; students only while the 3D Lab is enabled for their session."""
    if actor.is_student:
        enabled = await db.scalar(
            select(SessionModule.is_enabled).where(
                SessionModule.session_id == actor.student.session_id,
                SessionModule.module_key == MODULE_KEY,
            )
        )
        if not enabled:
            raise HTTPException(status_code=403, detail="AI 3D non è attivo in questa sessione")
    return actor


async def _credit_context(db: AsyncSession, actor: StudentOrTeacher) -> tuple[object, dict]:
    if not actor.is_student:
        return actor.teacher.tenant_id, {"teacher_id": actor.teacher.id}
    row = (await db.execute(
        select(Session, Class)
        .join(Class, Session.class_id == Class.id)
        .where(Session.id == actor.student.session_id)
    )).first()
    if not row:
        raise HTTPException(status_code=404, detail="Sessione non trovata")
    session, class_obj = row
    return actor.student.tenant_id, {
        "teacher_id": class_obj.teacher_id,
        "class_id": session.class_id,
        "session_id": session.id,
        "student_id": actor.student.id,
    }


# ── Asset proxy (no auth — URL is signed and validated to meshy.ai) ──────────

@router.get("/proxy-asset")
async def proxy_meshy_asset(url: str):
    """Proxy Meshy CDN assets to add CORS headers for model-viewer."""
    parsed = urlparse(url)
    if parsed.netloc not in ALLOWED_PROXY_DOMAINS:
        raise HTTPException(status_code=400, detail="URL not allowed")

    async def stream():
        async with httpx.AsyncClient(timeout=120.0, follow_redirects=True) as client:
            async with client.stream("GET", url) as resp:
                if resp.status_code != 200:
                    return
                async for chunk in resp.aiter_bytes(chunk_size=65536):
                    yield chunk

    ext = url.split("?")[0].rsplit(".", 1)[-1].lower()
    content_type = {
        "glb": "model/gltf-binary",
        "fbx": "application/octet-stream",
        "obj": "text/plain",
        "usdz": "model/vnd.usdz+zip",
        # Thumbnails: an image served as octet-stream is dropped by the browser (OpaqueResponseBlocking).
        "png": "image/png",
        "jpg": "image/jpeg",
        "jpeg": "image/jpeg",
        "webp": "image/webp",
    }.get(ext, "application/octet-stream")

    return StreamingResponse(
        stream(),
        media_type=content_type,
        headers={
            "Access-Control-Allow-Origin": "*",
            "Cache-Control": "public, max-age=3600",
        },
    )


# ── Text-to-Image ──────────────────────────────────────────────────────────────

@router.post("/text-to-image")
async def generate_image(
    request: dict,
    actor: Annotated[StudentOrTeacher, Depends(get_meshy_actor)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    if not settings.OPENAI_API_KEY:
        raise HTTPException(status_code=503, detail="Image generation not configured")

    prompt = request.get("prompt", "").strip()
    if not prompt:
        raise HTTPException(status_code=400, detail="Prompt required")

    tenant_id, credit_scope = await _credit_context(db, actor)
    estimated_cost = credit_service.calculate_cost_for_model("openai", settings.OPENAI_IMAGE_MODEL, 0, 0, image_count=1)
    allowed = await credit_service.check_availability(
        db,
        tenant_id,
        estimated_cost=estimated_cost,
        **credit_scope,
    )
    if not allowed:
        raise HTTPException(status_code=402, detail="Crediti insufficienti")

    try:
        result = await meshy_service.generate_image(
            prompt=prompt,
            size=request.get("size", "1024x1024"),
            quality=request.get("quality", "standard"),
            style=request.get("style", "natural"),
        )
        await credit_service.track_usage(
            db,
            tenant_id,
            "openai",
            settings.OPENAI_IMAGE_MODEL,
            estimated_cost,
            {
                "image_count": 1,
                "type": "meshy_lab_text_to_image",
                "service": "3D Lab",
                "size": request.get("size", "1024x1024"),
                "quality": request.get("quality", "standard"),
            },
            **credit_scope,
        )
        return result
    except Exception as e:
        logger.error(f"OpenAI image generation error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


MESHY_POLL_SECONDS = 5
MESHY_MAX_WAIT_SECONDS = 25 * 60


async def _follow_meshy_task(actor: StudentOrTeacher, mode: str, task_id: str, description: str) -> str:
    """Watch a Meshy task server-side as a background job, so the 3D Lab can show progress in the
    navbar and pick the task up again after the user changes page or reloads."""
    fetch = meshy_service.get_text_to_3d_status if mode == "text" else meshy_service.get_image_to_3d_status

    async def work(ctx: background_jobs.JobContext) -> dict:
        waited = 0.0
        last: dict = {}
        last_progress: float | None = None
        unchanged_for = 0.0
        try:
            while waited < MESHY_MAX_WAIT_SECONDS:
                try:
                    last = await fetch(task_id) or {}
                except Exception as exc:
                    logger.warning("Meshy poll failed for %s: %s", task_id, exc)
                state = str(last.get("status") or "").upper()
                progress = last.get("progress")
                if state == "SUCCEEDED":
                    break
                if state in ("FAILED", "EXPIRED", "CANCELED"):
                    message = (last.get("task_error") or {}).get("message") if isinstance(last.get("task_error"), dict) else None
                    raise RuntimeError(message or f"Meshy: generazione {state.lower()}")
                if isinstance(progress, (int, float)):
                    unchanged_for = unchanged_for + MESHY_POLL_SECONDS if progress == last_progress else 0.0
                    last_progress = float(progress)
                    # Meshy often sits on one percentage for minutes while it refines geometry and
                    # textures: say so, instead of looking stuck.
                    phase = "rifinisce geometria e texture, può richiedere qualche minuto" if unchanged_for >= 20 else "sta modellando"
                    label = f"Meshy {phase} · {int(progress)}%"
                else:
                    label = "In coda su Meshy…"
                await ctx.progress(float(progress) / 100 if isinstance(progress, (int, float)) else None, label, force=True)
                await asyncio.sleep(MESHY_POLL_SECONDS)
                waited += MESHY_POLL_SECONDS
            else:
                raise RuntimeError("Meshy non ha completato il modello in tempo")
        except asyncio.CancelledError:
            # Interrupted by the user: stop the task on Meshy too.
            try:
                await asyncio.shield(meshy_service.delete_task(mode, task_id))
            except Exception as exc:
                logger.warning("Meshy delete failed for %s: %s", task_id, exc)
            raise
        return {
            "mode": mode,
            "task_id": task_id,
            "status": last.get("status"),
            "model_urls": last.get("model_urls"),
            "thumbnail_url": last.get("thumbnail_url"),
        }

    job_id = await background_jobs.start_task_job(
        background_jobs.JobOwner.from_actor(actor),
        kind=f"meshy_{mode}_to_3d",
        title="Modello 3D con Meshy" + (" da testo" if mode == "text" else " da immagine"),
        description=description,
        route="module:models3d_ai" if actor.is_student else "/teacher/ai-3d",
        resource_id=task_id,
        expected_seconds=150.0 if mode == "text" else 300.0,
        work=work,
    )
    return str(job_id)


MESHY_STANDARD_MODELS = {"meshy-6-lite", "meshy-6", "meshy-7.1", "latest"}
MESHY_FORMATS = {"glb", "obj", "fbx", "stl", "usdz", "3mf"}


def _choice(request: dict, key: str, allowed: set, default):
    value = request.get(key, default)
    if value not in allowed:
        raise HTTPException(status_code=400, detail=f"Opzione Meshy non valida: {key}")
    return value


def _mesh_options(request: dict, *, has_image: bool) -> dict:
    """Validate the supported Meshy API options and normalize incompatible combinations."""
    raw = request.get("options") if isinstance(request.get("options"), dict) else request
    model_type = _choice(raw, "model_type", {"standard", "smart-topology"}, "standard")
    ai_model = "meshy-t2" if model_type == "smart-topology" else _choice(
        raw, "ai_model", MESHY_STANDARD_MODELS, "meshy-7.1"
    )
    geometry_resolution = _choice(raw, "geometry_resolution", {"standard", "2k", "4k"}, "standard")
    if geometry_resolution != "standard" and ai_model not in {"meshy-7.1", "latest"}:
        raise HTTPException(status_code=400, detail="La geometria 2K/4K richiede Meshy 7.1")

    should_remesh = bool(raw.get("should_remesh", False)) and model_type == "standard"
    topology = _choice(raw, "topology", {"triangle", "quad"}, "triangle")
    try:
        target_polycount = int(raw.get("target_polycount", 4000 if model_type == "smart-topology" else 30000))
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="target_polycount non valido")
    max_polycount = 15000 if model_type == "smart-topology" else 300000
    if not 100 <= target_polycount <= max_polycount:
        raise HTTPException(status_code=400, detail=f"target_polycount deve essere tra 100 e {max_polycount}")

    formats = raw.get("target_formats", ["glb", "obj", "fbx", "stl", "usdz"])
    if not isinstance(formats, list) or not formats or any(value not in MESHY_FORMATS for value in formats):
        raise HTTPException(status_code=400, detail="target_formats non valido")
    pose_mode = _choice(raw, "pose_mode", {"", "a-pose", "t-pose"}, "")

    options = {
        "ai_model": ai_model,
        "model_type": model_type,
        "geometry_resolution": geometry_resolution,
        "should_remesh": should_remesh,
        "topology": "triangle" if model_type == "smart-topology" else topology,
        "target_polycount": target_polycount,
        "pose_mode": pose_mode,
        "target_formats": formats,
        "auto_size": bool(raw.get("auto_size", False)),
        "alpha_thumbnail": bool(raw.get("alpha_thumbnail", False)),
    }
    if has_image:
        should_texture = bool(raw.get("should_texture", True))
        texture_resolution = _choice(raw, "texture_resolution", {"2k", "4k", "8k"}, "2k")
        if ai_model == "meshy-6-lite" and texture_resolution != "2k":
            raise HTTPException(status_code=400, detail="Meshy 6 Lite supporta solo texture 2K")
        options.update({
            "texture_prompt": str(request.get("prompt") or "").strip() or None,
            "should_texture": should_texture,
            "enable_pbr": bool(raw.get("enable_pbr", True)) and should_texture,
            "texture_resolution": texture_resolution,
            "image_enhancement": bool(raw.get("image_enhancement", True)),
        })
    return options


def _meshy_credit_cost(options: dict, *, has_image: bool) -> int:
    model = options["ai_model"]
    base = 5 if model in {"meshy-6-lite", "meshy-t2"} else 20
    if has_image and options.get("should_texture"):
        base += 15 if options.get("texture_resolution") == "8k" else 10
    if options.get("geometry_resolution") in {"2k", "4k"}:
        base += 5
    return base


async def _start_meshy_generation(request: dict, actor: StudentOrTeacher, db: AsyncSession) -> dict:
    _check_key()
    prompt = str(request.get("prompt") or "").strip()
    image_data = str(request.get("image_data") or "").strip()
    has_image = bool(image_data)
    if not prompt and not has_image:
        raise HTTPException(status_code=400, detail="Inserisci un testo o un'immagine di riferimento")
    if len(prompt) > 800:
        raise HTTPException(status_code=400, detail="Il testo può contenere al massimo 800 caratteri")

    options = _mesh_options(request, has_image=has_image)
    actual_model = options["ai_model"]
    meshy_credit_cost = _meshy_credit_cost(options, has_image=has_image)
    estimated_cost = round(meshy_credit_cost * MESHY_CREDIT_EUR, 6)
    tenant_id, credit_scope = await _credit_context(db, actor)
    if not await credit_service.check_availability(db, tenant_id, estimated_cost=estimated_cost, **credit_scope):
        raise HTTPException(status_code=402, detail="Crediti insufficienti")

    try:
        if has_image:
            task_id = await meshy_service.start_image_to_3d(
                image_data=image_data,
                image_mime=request.get("image_mime", "image/jpeg"),
                **options,
            )
            mode = "image"
        else:
            task_id = await meshy_service.start_text_to_3d(prompt=prompt, **options)
            mode = "text"
        await credit_service.track_usage(
            db, tenant_id, "meshy", actual_model, estimated_cost,
            {
                "image_count": 1,
                "type": f"{mode}_to_3d",
                "service": "3D Lab",
                "meshy_credits": meshy_credit_cost,
                "ai_model": actual_model,
                **{key: value for key, value in options.items() if key != "texture_prompt"},
            },
            **credit_scope,
        )
    except httpx.HTTPStatusError as exc:
        logger.error("Meshy generation error: %s %s", exc.response.status_code, exc.response.text)
        raise HTTPException(status_code=502, detail=exc.response.text)
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("Meshy generation error: %s", exc)
        raise HTTPException(status_code=500, detail=str(exc))

    description = prompt or "Modello 3D da immagine"
    job_id = await _follow_meshy_task(actor, mode, task_id, description)
    return {"task_id": task_id, "job_id": job_id, "task_type": mode, "ai_model": actual_model, "meshy_credits": meshy_credit_cost}


@router.post("/generate-3d")
async def generate_3d(
    request: dict,
    actor: Annotated[StudentOrTeacher, Depends(get_meshy_actor)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    return await _start_meshy_generation(request, actor, db)


# ── Text-to-3D (v2) ────────────────────────────────────────────────────────

@router.post("/text-to-3d")
async def start_text_to_3d(
    request: dict,
    actor: Annotated[StudentOrTeacher, Depends(get_meshy_actor)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    payload = dict(request)
    payload.pop("image_data", None)
    return await _start_meshy_generation(payload, actor, db)


@router.get("/text-to-3d/{task_id}")
async def get_text_to_3d_status(
    task_id: str,
    actor: Annotated[StudentOrTeacher, Depends(get_meshy_actor)],
):
    _check_key()
    try:
        return await meshy_service.get_text_to_3d_status(task_id)
    except httpx.HTTPStatusError:
        raise HTTPException(status_code=502, detail="Failed to fetch task status")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── Image-to-3D (v1) ───────────────────────────────────────────────────────

@router.post("/image-to-3d")
async def start_image_to_3d(
    request: dict,
    actor: Annotated[StudentOrTeacher, Depends(get_meshy_actor)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    return await _start_meshy_generation(request, actor, db)


@router.get("/image-to-3d/{task_id}")
async def get_image_to_3d_status(
    task_id: str,
    actor: Annotated[StudentOrTeacher, Depends(get_meshy_actor)],
):
    _check_key()
    try:
        return await meshy_service.get_image_to_3d_status(task_id)
    except httpx.HTTPStatusError:
        raise HTTPException(status_code=502, detail="Failed to fetch task status")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── Share a generated model in the class chat ─────────────────────────────

MAX_SHARED_MODEL_BYTES = 40 * 1024 * 1024


async def _download_meshy_asset(client: httpx.AsyncClient, url: Optional[str], max_bytes: int) -> Optional[bytes]:
    if not url or urlparse(url).netloc not in ALLOWED_PROXY_DOMAINS:
        return None
    try:
        resp = await client.get(url)
        if resp.status_code != 200 or len(resp.content) > max_bytes:
            return None
        return resp.content
    except Exception as exc:
        logger.warning("Meshy asset download failed: %s", exc)
        return None


@router.post("/share-to-chat")
async def share_model_to_chat(
    request: dict,
    actor: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Post a generated 3D model in the session's class chat.

    Meshy asset links are signed, expire and are blocked by browsers when embedded cross-origin, so
    the preview image and the GLB are copied into the chat's own storage first; the message is then
    saved and broadcast live like one sent from the chat panel."""
    from pathlib import Path
    import hashlib
    import uuid as _uuid
    from datetime import datetime as _dt
    from app.api.v1.endpoints.chat import get_or_create_public_room, _teacher_display_name
    from app.core.permissions import teacher_can_access_session
    from app.models.chat import ChatMessage
    from app.models.enums import OwnerType, Scope, SenderType
    from app.models.file import File as FileModel

    try:
        session_id = _uuid.UUID(str(request.get("session_id") or ""))
    except ValueError:
        raise HTTPException(status_code=400, detail="Sessione non valida")
    if actor.is_student:
        if actor.student.session_id != session_id:
            raise HTTPException(status_code=403, detail="Sessione non consentita")
    elif not await teacher_can_access_session(db, actor.teacher, session_id):
        raise HTTPException(status_code=404, detail="Sessione non trovata")

    label = str(request.get("label") or "Modello 3D").strip()[:120] or "Modello 3D"
    async with httpx.AsyncClient(timeout=90.0, follow_redirects=True) as client:
        thumbnail = await _download_meshy_asset(client, request.get("thumbnail_url"), 8 * 1024 * 1024)
        model = await _download_meshy_asset(client, request.get("glb_url"), MAX_SHARED_MODEL_BYTES)
    if not thumbnail and not model:
        raise HTTPException(status_code=502, detail="Impossibile recuperare il modello da Meshy: rigeneralo o riprova")

    tenant_id = actor.student.tenant_id if actor.is_student else actor.teacher.tenant_id
    upload_dir = Path("uploads/chat") / str(session_id)
    upload_dir.mkdir(parents=True, exist_ok=True)
    safe_name = "".join(ch if ch.isalnum() or ch in " -_" else "_" for ch in label).strip()[:60] or "modello"
    attachments: list[dict] = []
    for data, ext, mime, kind, filename in (
        (thumbnail, "png", "image/png", "image", f"{safe_name}.png"),
        (model, "glb", "model/gltf-binary", "model/gltf-binary", f"{safe_name}.glb"),
    ):
        if not data:
            continue
        stored = f"{_uuid.uuid4()}.{ext}"
        (upload_dir / stored).write_bytes(data)
        url = f"/uploads/chat/{session_id}/{stored}"
        attachments.append({"url": url, "type": kind, "filename": filename})
        db.add(FileModel(
            tenant_id=tenant_id,
            owner_type=OwnerType.STUDENT if actor.is_student else OwnerType.TEACHER,
            owner_student_id=actor.student.id if actor.is_student else None,
            owner_teacher_id=None if actor.is_student else actor.teacher.id,
            scope=Scope.SESSION,
            session_id=session_id,
            storage_key=f"chat/{session_id}/{stored}",
            filename=filename,
            mime_type=mime,
            size_bytes=len(data),
            checksum_sha256=hashlib.sha256(data).hexdigest(),
        ))

    room = await get_or_create_public_room(db, session_id, tenant_id)
    text = f"🧊 Modello 3D: \"{label}\""
    message = ChatMessage(
        tenant_id=tenant_id,
        session_id=session_id,
        room_id=room.id,
        sender_type=SenderType.STUDENT if actor.is_student else SenderType.TEACHER,
        sender_student_id=actor.student.id if actor.is_student else None,
        sender_teacher_id=None if actor.is_student else actor.teacher.id,
        message_text=text,
        attachments=attachments,
    )
    db.add(message)
    owner_id = (await db.execute(
        select(Class.teacher_id).join(Session, Session.class_id == Class.id).where(Session.id == session_id)
    )).scalar_one_or_none()
    await db.commit()
    await db.refresh(message)

    if actor.is_student:
        sender_id, sender_name = actor.student.id, actor.student.nickname
        avatar, accent = actor.student.avatar_url, actor.student.ui_accent
    else:
        sender_id, sender_name = actor.teacher.id, _teacher_display_name(actor.teacher)
        avatar, accent = actor.teacher.avatar_url, actor.teacher.ui_accent
    payload = {
        "id": str(message.id),
        "sender_type": "STUDENT" if actor.is_student else "TEACHER",
        "sender_id": str(sender_id),
        "sender_name": sender_name,
        "sender_avatar_url": avatar,
        "sender_is_class_owner": bool(not actor.is_student and owner_id == actor.teacher.id),
        "sender_accent": accent,
        "text": text,
        "attachments": attachments,
        "reply_to_id": None,
        "reply_preview": None,
        "created_at": (message.created_at or _dt.utcnow()).isoformat(),
    }
    await sio.emit(
        "chat_message",
        {"room_type": "PUBLIC", "session_id": str(session_id), "message": payload},
        room=f"session:{session_id}",
    )
    return {"message_id": str(message.id), "attachments": attachments}
