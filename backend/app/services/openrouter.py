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
    images = await image_models(client)
    image_ids = {item["id"] for item in images}
    found = []
    for item in response.json()["data"]:
        if "text" not in item.get("architecture", {}).get("output_modalities", []) or item["id"] in image_ids:
            continue  # image generators are listed below, as images
        pricing = item.get("pricing") or {}
        found.append({"id": item["id"], "name": item.get("name") or item["id"], "kind": "text",
                      "input_usd": token_price(pricing.get("prompt")),
                      "output_usd": token_price(pricing.get("completion")),
                      "context_window": item.get("context_length")})
    for item in images:
        found.append({"id": item["id"], "name": item.get("name") or item["id"], "kind": "image"})
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
                       duration: int, aspect_ratio: str, resolution: str | None,
                       generate_audio: bool | None = None) -> str:
    import base64

    payload = {"model": model, "prompt": prompt, "duration": duration, "aspect_ratio": aspect_ratio,
               "frame_images": [{"type": "image_url", "image_url": {
                   "url": "data:image/jpeg;base64," + base64.b64encode(image).decode()}, "frame_type": "first_frame"}]}
    if resolution:
        payload["resolution"] = resolution
    if generate_audio is not None:
        payload["generate_audio"] = generate_audio
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


# ── image-to-video catalogue used by Video Studio ───────────────────────────

_catalog_cache: tuple[float, list[dict]] = (0.0, [])


def _res_value(res: str) -> int:
    digits = "".join(c for c in str(res) if c.isdigit())
    if str(res).upper() == "2K":
        return 1440
    if str(res).upper() == "4K":
        return 2160
    return int(digits) if digits else 0


def sku_usd_per_second(model: dict, resolution: str | None, audio: bool) -> float | None:
    """Best-effort USD per output second from the heterogeneous `pricing_skus` of a model.

    Prices are quoted either in USD ("duration_seconds_720p") or in cents ("cents_per_..."). Per-image or
    per-reference extras are ignored. Returns None when no per-second price can be identified.
    """
    best: tuple[int, float] | None = None
    for key, raw in (model.get("pricing_skus") or {}).items():
        k = key.lower()
        if "second" not in k or any(x in k for x in ("input", "reference", "megapixel", "minimum", "text_to_video")):
            continue
        try:
            value = float(raw) / (100 if k.startswith("cents_") else 1)
        except (TypeError, ValueError):
            continue
        score = 0
        if resolution and resolution.lower() in k:
            score += 4
        elif any(r in k for r in ("480p", "720p", "768p", "1080p", "2k", "4k")):
            score -= 3  # a different resolution's price
        if "image_to_video" in k:
            score += 2
        if audio and "with_audio" in k and "without" not in k:
            score += 2
        if not audio and "without_audio" in k:
            score += 2
        if not audio and "with_audio" in k and "without" not in k:
            score -= 2
        if best is None or score > best[0]:
            best = (score, value)
    if best:
        return best[1]
    return _token_usd_per_second(model, resolution, audio)


def _token_usd_per_second(model: dict, resolution: str | None, audio: bool) -> float | None:
    """Seedance-style models bill video tokens: tokens ~= width * height * 24 fps / 1024 per second (16:9 estimate)."""
    skus = model.get("pricing_skus") or {}
    keys = [k for k in skus if k.startswith("video_tokens") and "video_input" not in k]
    if not keys:
        return None
    res = (resolution or "").lower()
    keyed = [k for k in keys if res and res in k]
    plain = [k for k in keys if not any(r in k for r in ("480p", "720p", "1080p", "4k", "2k")) and ("without_audio" in k) != audio]
    chosen = (keyed or plain or keys)[0]
    height = _res_value(resolution) if resolution else 720
    try:
        return float(skus[chosen]) * (height * 16 / 9) * height * 24 / 1024
    except (TypeError, ValueError):
        return None


def default_resolution(options: list[str] | None) -> str | None:
    """Cheapest resolution that is still watchable (>= 720p when offered)."""
    if not options:
        return None
    ordered = sorted(options, key=_res_value)
    return next((r for r in ordered if _res_value(r) >= 720), ordered[-1])


async def video_catalog(client: httpx.AsyncClient) -> list[dict]:
    """Models that can animate a still frame (what Video Studio needs), cached for 10 minutes."""
    import time

    global _catalog_cache
    if time.monotonic() - _catalog_cache[0] < 600 and _catalog_cache[1]:
        return _catalog_cache[1]
    usable = []
    for m in await video_models(client):
        if "first_frame" not in (m.get("supported_frame_images") or []) or not m.get("supported_durations"):
            continue
        usable.append(m)
    _catalog_cache = (time.monotonic(), usable)
    return usable


def pick_duration(supported: list[int], wanted: float) -> int:
    """Shortest supported duration covering `wanted` seconds (else the longest one)."""
    options = sorted(set(int(d) for d in supported))
    return next((d for d in options if d >= wanted), options[-1])


# ── image generation (dedicated Image API) ──────────────────────────────────

def is_openrouter_image_model(model: str | None) -> bool:
    """OpenRouter slugs carry the vendor (`google/gemini-…`); OpenAI image ids never do."""
    return bool(model) and "/" in model


def _ratio(label: str) -> float | None:
    try:
        w, h = (float(v) for v in label.split(":"))
        return w / h
    except ValueError:
        return None


def _aspect(size: str, allowed: list[str] | None) -> str | None:
    """Supported aspect ratio closest to the requested WxH (None when the model takes no aspect ratio)."""
    try:
        w, h = (int(v) for v in size.lower().split("x"))
        wanted = w / h
    except ValueError:
        wanted = 1.0
    options = {label: r for label in (allowed or ["1:1", "3:2", "2:3", "4:3", "3:4", "16:9", "9:16"]) if (r := _ratio(label))}
    return min(options, key=lambda k: abs(options[k] - wanted)) if options else None


_image_params: tuple[float, dict[str, dict]] = (0.0, {})


async def image_models(client: httpx.AsyncClient) -> list[dict]:
    response = await client.get(f"{BASE_URL}/images/models", headers=headers())
    response.raise_for_status()
    return response.json()["data"]


async def _supported(client: httpx.AsyncClient, model: str) -> dict:
    """supported_parameters of an image model, from the catalogue cached for an hour."""
    import time

    global _image_params
    if time.monotonic() - _image_params[0] > 3600 or model not in _image_params[1]:
        _image_params = (time.monotonic(), {m["id"]: m.get("supported_parameters") or {} for m in await image_models(client)})
    return _image_params[1].get(model, {})


async def generate_image(model: str, prompt: str, size: str = "1024x1024", references: list[bytes] | None = None,
                         mime: str = "image/png") -> tuple[bytes, str, float | None]:
    """One image from an OpenRouter image model at ~1 megapixel. Returns (bytes, media type, provider cost in USD if reported)."""
    import base64

    async with httpx.AsyncClient(timeout=180) as client:
        params = await _supported(client, model)
        payload: dict = {"model": model, "prompt": prompt}
        if "aspect_ratio" in params:
            aspect = _aspect(size, (params["aspect_ratio"] or {}).get("values"))
            if aspect:
                payload["aspect_ratio"] = aspect
        if "1K" in ((params.get("resolution") or {}).get("values") or []):
            payload["resolution"] = "1K"  # the tier the catalogue prices are estimated on
        limit = int((params.get("input_references") or {}).get("max") or 0)
        if references and limit:
            payload["input_references"] = [{"type": "image_url", "image_url": {"url": f"data:{mime};base64,{base64.b64encode(r).decode()}"}}
                                           for r in references[:limit]]
        # No retry: a timed-out POST may already have been charged.
        response = await client.post(f"{BASE_URL}/images", headers=headers(), json=payload)
    if response.status_code >= 400:
        raise RuntimeError(f"OpenRouter {response.status_code}: {response.text[:300]}")
    body = response.json()
    item = next((d for d in body.get("data") or [] if d.get("b64_json")), None)
    if not item:
        raise RuntimeError("Il modello immagine non ha restituito dati")
    cost = (body.get("usage") or {}).get("cost")
    return base64.b64decode(item["b64_json"]), item.get("media_type") or "image/png", float(cost) if cost is not None else None
