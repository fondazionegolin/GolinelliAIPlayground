"""Server-side OpenRouter transport and catalogue normalization."""
from decimal import Decimal, InvalidOperation
from urllib.parse import quote

import httpx

from app.core.config import settings

BASE_URL = "https://openrouter.ai/api/v1"


class VideoJobFailed(RuntimeError):
    """Terminal provider failure: a subsequent render must submit a new job."""


def headers() -> dict[str, str]:
    if not settings.OPENROUTER_API_KEY:
        raise RuntimeError("OPENROUTER_API_KEY non configurata nel file .env")
    return {"Authorization": f"Bearer {settings.OPENROUTER_API_KEY}"}


def token_price(value) -> float | None:
    """OpenRouter quotes USD/token; our billing table stores USD/million tokens."""
    if value is None:
        return None
    try:
        price = Decimal(str(value)) * 1_000_000
        return float(price) if price.is_finite() and 0 <= price < Decimal("1e12") else None
    except (InvalidOperation, ValueError):
        return None


async def video_models(client: httpx.AsyncClient) -> list[dict]:
    response = await client.get(f"{BASE_URL}/videos/models", headers=headers())
    response.raise_for_status()
    return response.json()["data"]


async def discover(client: httpx.AsyncClient) -> list[dict]:
    response = await client.get(f"{BASE_URL}/models", headers=headers())
    response.raise_for_status()
    found = []
    for item in response.json()["data"]:
        if "text" not in item.get("architecture", {}).get("output_modalities", []):
            continue
        pricing = item.get("pricing") or {}
        found.append({"id": item["id"], "name": item.get("name") or item["id"], "kind": "text",
                      "input_usd": token_price(pricing.get("prompt")),
                      "output_usd": token_price(pricing.get("completion")),
                      "context_window": item.get("context_length")})
    for item in await video_models(client):
        note = "; ".join(f"{sku}: ${price}" for sku, price in (item.get("pricing_skus") or {}).items())
        found.append({"id": item["id"], "name": item.get("name") or item["id"], "kind": "video", "price_note": note[:200] or None})
    return found


def validate_video_options(model: dict, duration: int, aspect_ratio: str, resolution: str | None) -> None:
    for name, value, key in (("durata", duration, "supported_durations"),
                             ("formato", aspect_ratio, "supported_aspect_ratios"),
                             ("risoluzione", resolution, "supported_resolutions")):
        allowed = model.get(key) or []
        if value is not None and allowed and value not in allowed:
            raise ValueError(f"{name} non supportata: {value}. Valori consentiti: {allowed}")


async def submit_video(client: httpx.AsyncClient, *, model: str, prompt: str, image: bytes,
                       duration: int, aspect_ratio: str, resolution: str | None) -> str:
    import base64

    payload = {"model": model, "prompt": prompt, "duration": duration, "aspect_ratio": aspect_ratio,
               "frame_images": [{"type": "image_url", "image_url": {
                   "url": "data:image/jpeg;base64," + base64.b64encode(image).decode()}, "frame_type": "first_frame"}]}
    if resolution:
        payload["resolution"] = resolution
    # Do not retry submissions: a timed-out POST may already have incurred a charge.
    response = await client.post(f"{BASE_URL}/videos", headers=headers(), json=payload)
    response.raise_for_status()
    return response.json()["id"]


async def wait_video(client: httpx.AsyncClient, job_id: str) -> tuple[bytes, float]:
    import asyncio

    # Build URLs ourselves: never forward credentials to a URL supplied by a job response.
    url = f"{BASE_URL}/videos/{quote(job_id, safe='')}"
    async with asyncio.timeout(1800):
        while True:
            response = await client.get(url, headers=headers())
            response.raise_for_status()
            job = response.json()
            if job["status"] == "completed":
                result = await client.get(f"{url}/content", headers=headers(), follow_redirects=True)
                result.raise_for_status()
                return result.content, float((job.get("usage") or {}).get("cost") or 0)
            if job["status"] in {"failed", "cancelled", "expired"}:
                raise VideoJobFailed(f"Generazione video OpenRouter: {job['status']}")
            await asyncio.sleep(15)
