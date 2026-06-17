import logging
from urllib.parse import urlparse
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from typing import Annotated
import httpx

from app.core.database import get_db
from app.api.deps import get_current_teacher
from app.models.user import User
from app.services.meshy_service import meshy_service
from app.services.credit_service import credit_service
from app.core.config import settings
from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)

router = APIRouter()

ALLOWED_PROXY_DOMAINS = {"assets.meshy.ai", "cdn.meshy.ai"}


def _check_key():
    if not settings.MESHY_API_KEY:
        raise HTTPException(status_code=503, detail="3D generation not configured")


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
    }.get(ext, "application/octet-stream")

    return StreamingResponse(
        stream(),
        media_type=content_type,
        headers={
            "Access-Control-Allow-Origin": "*",
            "Cache-Control": "public, max-age=3600",
        },
    )


# ── Text-to-Image (DALL-E 3) ──────────────────────────────────────────────────

@router.post("/text-to-image")
async def generate_image(
    request: dict,
    teacher: Annotated[User, Depends(get_current_teacher)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    if not settings.OPENAI_API_KEY:
        raise HTTPException(status_code=503, detail="Image generation not configured")

    prompt = request.get("prompt", "").strip()
    if not prompt:
        raise HTTPException(status_code=400, detail="Prompt required")

    estimated_cost = credit_service.calculate_cost_for_model("openai", "dall-e-3", 0, 0, image_count=1)
    allowed = await credit_service.check_availability(
        db,
        teacher.tenant_id,
        estimated_cost=estimated_cost,
        teacher_id=teacher.id,
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
            teacher.tenant_id,
            "openai",
            "dall-e-3",
            estimated_cost,
            {
                "image_count": 1,
                "type": "meshy_lab_text_to_image",
                "size": request.get("size", "1024x1024"),
                "quality": request.get("quality", "standard"),
            },
            teacher_id=teacher.id,
        )
        return result
    except Exception as e:
        logger.error(f"DALL-E image generation error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ── Text-to-3D (v2) ────────────────────────────────────────────────────────

@router.post("/text-to-3d")
async def start_text_to_3d(
    request: dict,
    teacher: Annotated[User, Depends(get_current_teacher)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    _check_key()
    prompt = request.get("prompt", "").strip()
    if not prompt:
        raise HTTPException(status_code=400, detail="Prompt required")
    model = "meshy-text-to-3d-preview"
    estimated_cost = credit_service.calculate_cost_for_model("meshy", model, 0, 0, image_count=1)
    allowed = await credit_service.check_availability(
        db,
        teacher.tenant_id,
        estimated_cost=estimated_cost,
        teacher_id=teacher.id,
    )
    if not allowed:
        raise HTTPException(status_code=402, detail="Crediti insufficienti")
    try:
        task_id = await meshy_service.start_text_to_3d(
            prompt=prompt,
            negative_prompt=request.get("negative_prompt", "low quality, low resolution, ugly"),
        )
        await credit_service.track_usage(
            db,
            teacher.tenant_id,
            "meshy",
            model,
            estimated_cost,
            {"image_count": 1, "type": "text_to_3d", "meshy_credits": 20},
            teacher_id=teacher.id,
        )
    except httpx.HTTPStatusError as e:
        logger.error(f"Meshy text-to-3D error: {e.response.status_code} {e.response.text}")
        raise HTTPException(status_code=502, detail=e.response.text)
    except Exception as e:
        logger.error(f"Meshy text-to-3D error: {e}")
        raise HTTPException(status_code=500, detail=str(e))
    return {"task_id": task_id}


@router.get("/text-to-3d/{task_id}")
async def get_text_to_3d_status(
    task_id: str,
    teacher: Annotated[User, Depends(get_current_teacher)],
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
    teacher: Annotated[User, Depends(get_current_teacher)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    _check_key()
    image_data = request.get("image_data", "").strip()
    if not image_data:
        raise HTTPException(status_code=400, detail="image_data required")
    enable_pbr = bool(request.get("enable_pbr", True))
    model = "meshy-image-to-3d-pbr" if enable_pbr else "meshy-image-to-3d"
    meshy_credit_cost = 30 if enable_pbr else 20
    estimated_cost = credit_service.calculate_cost_for_model("meshy", model, 0, 0, image_count=1)
    allowed = await credit_service.check_availability(
        db,
        teacher.tenant_id,
        estimated_cost=estimated_cost,
        teacher_id=teacher.id,
    )
    if not allowed:
        raise HTTPException(status_code=402, detail="Crediti insufficienti")
    try:
        task_id = await meshy_service.start_image_to_3d(
            image_data=image_data,
            image_mime=request.get("image_mime", "image/jpeg"),
            enable_pbr=enable_pbr,
            topology=request.get("topology", "quad"),
            target_polycount=request.get("target_polycount", 30000),
        )
        await credit_service.track_usage(
            db,
            teacher.tenant_id,
            "meshy",
            model,
            estimated_cost,
            {
                "image_count": 1,
                "type": "image_to_3d",
                "meshy_credits": meshy_credit_cost,
                "enable_pbr": enable_pbr,
            },
            teacher_id=teacher.id,
        )
    except httpx.HTTPStatusError as e:
        logger.error(f"Meshy image-to-3D error: {e.response.status_code} {e.response.text}")
        raise HTTPException(status_code=502, detail=e.response.text)
    except Exception as e:
        logger.error(f"Meshy image-to-3D error: {e}")
        raise HTTPException(status_code=500, detail=str(e))
    return {"task_id": task_id}


@router.get("/image-to-3d/{task_id}")
async def get_image_to_3d_status(
    task_id: str,
    teacher: Annotated[User, Depends(get_current_teacher)],
):
    _check_key()
    try:
        return await meshy_service.get_image_to_3d_status(task_id)
    except httpx.HTTPStatusError:
        raise HTTPException(status_code=502, detail="Failed to fetch task status")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
