"""Cover art for Audio Lab tracks: AI-generated from the track description, or uploaded by the teacher."""
import asyncio
import base64
import io
import logging
from uuid import uuid4

from fastapi import HTTPException

from app.services.model_roles import openai_image_model
from app.core.config import settings
from app.core.pricing import USD_TO_EUR
from app.services import drive_service as drive
from app.services.credit_service import credit_service, to_credits
from app.services.llm_service import llm_service

logger = logging.getLogger(__name__)
COVER_USD = 0.016  # gpt-image, low quality, 1024x1024
COVER_CREDITS = to_credits(COVER_USD * USD_TO_EUR)
MAX_COVER_BYTES = 8 * 1024 * 1024


def _jpeg(data: bytes) -> bytes:
    from PIL import Image, UnidentifiedImageError
    try:
        with Image.open(io.BytesIO(data)) as im:
            im = im.convert("RGB")
            side = min(im.size)  # square crop from the centre
            left, top = (im.width - side) // 2, (im.height - side) // 2
            im = im.crop((left, top, left + side, top + side)).resize((min(side, 768),) * 2)
            out = io.BytesIO()
            im.save(out, format="JPEG", quality=88)
            return out.getvalue()
    except (UnidentifiedImageError, OSError, ValueError) as exc:
        raise HTTPException(422, "Carica un'immagine valida (JPG, PNG o WebP)") from exc


def prompt_for(title: str, description: str) -> str:
    return ("Square album cover artwork for a piece of music. Evocative illustration that matches the mood, genre and instruments of the music. "
            "No text, no letters, no logos, no real people, no recognisable brands. "
            f"Title: {title[:120]}. Music description: {description[:700]}")


async def store(db, teacher, item, image: bytes) -> None:
    jpeg = await asyncio.to_thread(_jpeg, image)
    old = (item.details or {}).get("cover_key")
    key = f"drive/{teacher.tenant_id}/{teacher.id}/voice-lab/{item.id}-cover-{uuid4().hex[:8]}.jpg"
    await asyncio.to_thread(drive.write_blob, key, jpeg)
    item.details = {**(item.details or {}), "cover_key": key}
    await db.commit()
    if old:
        try:
            await asyncio.to_thread(drive.delete_blob, old)
        except Exception:  # an orphaned thumbnail is harmless
            logger.info("could not remove old cover %s", old)


async def remove(db, item) -> None:
    key = (item.details or {}).get("cover_key")
    item.details = {k: v for k, v in (item.details or {}).items() if k != "cover_key"}
    await db.commit()
    if key:
        try:
            await asyncio.to_thread(drive.delete_blob, key)
        except Exception:
            logger.info("could not remove cover %s", key)


async def generate(db, teacher, item) -> None:
    """Paid AI cover. Raises HTTPException with a user-facing message on any failure."""
    if llm_service.openai_client is None:
        raise HTTPException(503, "La generazione di immagini non è configurata sul server.")
    cost = round(COVER_USD * USD_TO_EUR, 6)
    if not await credit_service.check_availability(db, teacher.tenant_id, cost, teacher_id=teacher.id):
        raise HTTPException(402, "Crediti insufficienti per generare la copertina")
    details = item.details or {}
    try:
        resp = await llm_service.openai_client.images.generate(model=openai_image_model(), n=1, size="1024x1024", quality="low",
                                                               prompt=prompt_for(item.title, details.get("text") or ""))
        b64 = resp.data[0].b64_json
        if not b64:
            raise RuntimeError("empty image")
    except HTTPException:
        raise
    except Exception as exc:
        logger.warning("cover generation failed for %s: %s", item.id, exc)
        raise HTTPException(502, "Non sono riuscito a creare la copertina. Riprova.") from exc
    await credit_service.track_usage(db, teacher.tenant_id, "openai", openai_image_model(), cost,
                                     {"type": "voice_lab", "service": "Audio Lab", "action": "cover", "item_id": str(item.id)}, teacher_id=teacher.id)
    await store(db, teacher, item, base64.b64decode(b64))
