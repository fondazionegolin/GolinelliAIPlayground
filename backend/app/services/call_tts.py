"""Text-to-speech for recordings: ElevenLabs first, OpenRouter speech models as the fallback.

ElevenLabs gives the best voices; when it fails (outage, quota, key problems) or does not cover the language, the same
text is spoken by an OpenRouter model (`POST /api/v1/audio/speech`), so the service stays up. Every attempt reserves its
cost in the teacher's credits first and settles it afterwards (refunded when the attempt fails).
Output is always one MP3.
"""
from __future__ import annotations

import asyncio
import logging
import re
import time
from dataclasses import dataclass
from typing import Awaitable, Callable, Optional

import httpx
from fastapi import HTTPException

from app.core.config import settings
from app.core.pricing import USD_TO_EUR
from app.services import voice_lab as eleven
from app.services import voice_lab_billing as billing
from app.services.credit_service import to_credits

logger = logging.getLogger(__name__)
OPENROUTER_SPEECH_URL = "https://openrouter.ai/api/v1/audio/speech"
OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models?output_modalities=speech"
ELEVEN_CHUNK = 3500
OPENROUTER_CHUNK = 3000
ELEVEN_MODEL_PREFERENCE = ("eleven_multilingual_v2", "eleven_v3", "eleven_flash_v2_5", "eleven_turbo_v2_5")
SPEECH_CHARS_PER_SECOND = 15.0  # estimate used to price models that bill by generated audio tokens
AUDIO_TOKENS_PER_SECOND = 25

# Curated fallback models: multilingual, language detected from the text. Verified 2026-11-17 on OpenRouter.
FALLBACKS: dict[str, dict] = {
    "google/gemini-3.8-flash-tts": {"label": "Gemini 3.8 Flash TTS · Google", "voice": "Kore", "format": "pcm",
                                    "note": "Molte lingue, rileva la lingua dal testo"},
    "google/gemini-3.8-flash-lite-tts": {"label": "Gemini 3.8 Flash Lite TTS · Google", "voice": "Kore", "format": "pcm",
                                         "note": "Più economico"},
    "elevenlabs/eleven-multilingual-v2": {"label": "ElevenLabs Multilingual v2 (via OpenRouter)", "voice": "sarah", "format": "mp3",
                                          "note": "Stesse voci ElevenLabs, ma attraverso OpenRouter"},
}
DEFAULT_FALLBACK = "google/gemini-3.8-flash-tts"


@dataclass
class SpeechResult:
    audio: bytes
    provider: str
    model: str
    voice: str
    characters: int
    seconds: float


def clean_for_speech(text: str) -> str:
    """Drop what a voice must not read: timestamps, speaker labels, markdown marks."""
    text = re.sub(r"^\s*\[\d{1,2}:\d{2}(?::\d{2})?\]\s*[^:\n]{1,60}:\s*", "", text, flags=re.M)
    text = re.sub(r"^\s{0,3}#{1,6}\s*", "", text, flags=re.M)
    text = re.sub(r"^\s*[-*•]\s+", "", text, flags=re.M)
    text = re.sub(r"[*_`>|]", "", text)
    text = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", text)
    return re.sub(r"\n{3,}", "\n\n", text).strip()


def split_text(text: str, limit: int) -> list[str]:
    """Chunks under `limit` characters, cut at paragraph or sentence ends."""
    chunks: list[str] = []
    current = ""
    pieces: list[str] = []
    for paragraph in re.split(r"\n\s*\n", text):
        if len(paragraph) <= limit:
            pieces.append(paragraph)
            continue
        pieces.extend(s for s in re.split(r"(?<=[.!?。！？])\s+", paragraph) if s)
    for piece in pieces:
        while len(piece) > limit:  # a single huge sentence
            cut = piece.rfind(" ", 0, limit)
            cut = cut if cut > limit // 2 else limit
            piece, rest = piece[:cut], piece[cut:].lstrip()
            if current:
                chunks.append(current)
                current = ""
            chunks.append(piece)
            piece = rest
        if current and len(current) + len(piece) + 2 > limit:
            chunks.append(current)
            current = piece
        else:
            current = f"{current}\n\n{piece}" if current else piece
    if current.strip():
        chunks.append(current)
    return [c.strip() for c in chunks if c.strip()]


async def _ffmpeg_mp3(data: bytes, *, pcm: bool) -> bytes:
    args = ["ffmpeg", "-hide_banner", "-loglevel", "error"]
    if pcm:
        args += ["-f", "s16le", "-ar", "24000", "-ac", "1"]
    args += ["-i", "pipe:0", "-vn", "-ac", "1", "-c:a", "libmp3lame", "-b:a", "64k", "-f", "mp3", "pipe:1"]
    proc = await asyncio.create_subprocess_exec(*args, stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
    out, err = await proc.communicate(data)
    if proc.returncode != 0 or len(out) < 500:
        logger.warning("ffmpeg tts conversion failed: %s", err[-300:])
        raise HTTPException(502, "Conversione audio non riuscita")
    return out


# ── ElevenLabs ────────────────────────────────────────────────────────────────

async def eleven_model_for(language: str) -> tuple[str, int]:
    """(model id, max characters per request) of the first preferred ElevenLabs model that speaks `language`."""
    catalogue = [m for m in await eleven.models() if m["tts"]]
    for wanted in ELEVEN_MODEL_PREFERENCE:
        for model in catalogue:
            codes = {str(l.get("language_id", "")).lower() for l in model.get("languages") or []}
            if model["model_id"] == wanted and (not codes or language.lower() in codes):
                return wanted, min(ELEVEN_CHUNK, int(model.get("max_characters") or ELEVEN_CHUNK))
    raise HTTPException(422, "ElevenLabs non copre questa lingua")


async def default_eleven_voice() -> str:
    voices = await eleven.account_voices()
    if not voices:
        raise HTTPException(503, "Nessuna voce ElevenLabs disponibile")
    return voices[0]["voice_id"]


async def _speak_elevenlabs(text: str, language: str, voice_id: Optional[str], tick: Callable[[float], Awaitable[None]]) -> tuple[bytes, str, str]:
    if not settings.ELEVENLABS_API_KEY:
        raise HTTPException(503, "ElevenLabs non configurato")
    model, limit = await eleven_model_for(language)
    voice = eleven.identifier(voice_id) if voice_id else await default_eleven_voice()
    parts: list[bytes] = []
    chunks = split_text(text, limit)
    for index, chunk in enumerate(chunks):
        body = {"text": chunk, "model_id": model}
        if model != "eleven_multilingual_v2":  # this model has no language_code parameter: it detects the language
            body["language_code"] = language
        response = await eleven.request("POST", f"/v1/text-to-speech/{voice}", params={"output_format": "mp3_44100_128"}, json=body)
        parts.append(eleven.audio(response))
        await tick((index + 1) / len(chunks))
    return await _ffmpeg_mp3(b"".join(parts), pcm=False), model, voice


# ── OpenRouter ────────────────────────────────────────────────────────────────

_pricing_cache: dict = {"at": 0.0, "data": {}}


async def openrouter_models() -> dict[str, dict]:
    """Speech models of OpenRouter by id (cached for an hour)."""
    if _pricing_cache["data"] and time.time() - _pricing_cache["at"] < 3600:
        return _pricing_cache["data"]
    try:
        async with httpx.AsyncClient(timeout=20) as client:
            response = await client.get(OPENROUTER_MODELS_URL)
            response.raise_for_status()
        _pricing_cache["data"] = {m["id"]: m for m in response.json().get("data", [])}
        _pricing_cache["at"] = time.time()
    except (httpx.HTTPError, ValueError, KeyError) as exc:
        logger.warning("OpenRouter speech model list unavailable: %s", exc)
    return _pricing_cache["data"]


def openrouter_usd(model_info: Optional[dict], characters: int) -> float:
    """Estimated cost: per input character, or per generated audio token for models that bill by output."""
    pricing = (model_info or {}).get("pricing") or {}
    try:
        prompt, completion = float(pricing.get("prompt") or 0), float(pricing.get("completion") or 0)
    except (TypeError, ValueError):
        prompt = completion = 0.0
    if completion > 0:  # Gemini: text tokens in (~4 chars each), audio tokens out
        return characters / 4 * prompt + characters / SPEECH_CHARS_PER_SECOND * AUDIO_TOKENS_PER_SECOND * completion
    return characters * prompt if prompt > 0 else characters * 0.000015


async def fallback_options() -> list[dict]:
    available = await openrouter_models()
    out = []
    for model_id, spec in FALLBACKS.items():
        info = available.get(model_id)
        if available and not info:
            continue  # the catalogue answered and the model is gone
        out.append({"model": model_id, "label": spec["label"], "note": spec["note"], "voice": spec["voice"],
                    "usd_per_1000_characters": round(openrouter_usd(info, 1000), 4)})
    return out


async def _speak_openrouter(text: str, model: str, voice: Optional[str], tick: Callable[[float], Awaitable[None]]) -> tuple[bytes, str]:
    if not settings.OPENROUTER_API_KEY:
        raise HTTPException(503, "OpenRouter non configurato")
    spec = FALLBACKS.get(model)
    if not spec:
        raise HTTPException(422, "Modello vocale non disponibile")
    speaker = spec["voice"]  # ElevenLabs voice ids do not exist here: the model's own default voice
    pcm = spec["format"] == "pcm"
    chunks = split_text(text, OPENROUTER_CHUNK)
    parts: list[bytes] = []
    async with httpx.AsyncClient(timeout=httpx.Timeout(240, connect=20)) as client:
        for index, chunk in enumerate(chunks):
            try:
                response = await client.post(OPENROUTER_SPEECH_URL, headers={"Authorization": f"Bearer {settings.OPENROUTER_API_KEY}"},
                                             json={"model": model, "input": chunk, "voice": speaker, "response_format": spec["format"]})
            except httpx.HTTPError as exc:
                raise HTTPException(502, "OpenRouter non risponde") from exc
            if response.status_code != 200 or len(response.content) < 500:
                logger.warning("OpenRouter speech %s -> HTTP %s: %s", model, response.status_code, response.text[:300])
                raise HTTPException(502, "OpenRouter non ha restituito audio")
            parts.append(response.content)
            await tick((index + 1) / len(chunks))
    return await _ffmpeg_mp3(b"".join(parts), pcm=pcm), speaker


# ── Orchestration ─────────────────────────────────────────────────────────────

def _price(provider: str, model: str, characters: int, info: Optional[dict] = None) -> dict:
    if provider == "elevenlabs":
        return billing.quote("tts", characters=characters, model=model)
    usd = round(openrouter_usd(info, characters), 8)
    cost = round(usd * USD_TO_EUR, 10)
    return {"action": "tts", "cost": cost, "credits": to_credits(cost), "usd": usd, "quantity": characters, "unit": "characters",
            "rate_usd": usd / max(1, characters), "usd_to_eur": USD_TO_EUR, "source": "https://openrouter.ai/models?output_modalities=speech",
            "pricing_basis": "openrouter_speech_estimate"}


async def synthesize(
    db, teacher, text: str, language: str, *, voice_id: Optional[str] = None, provider: str = "auto",
    fallback_model: Optional[str] = None, progress: Optional[Callable[[float, str], Awaitable[None]]] = None,
) -> SpeechResult:
    """One MP3 of `text` spoken in `language`. provider: auto (ElevenLabs, then fallback) | elevenlabs | openrouter."""
    text = clean_for_speech(text)
    if not text:
        raise HTTPException(422, "Non c'è testo da leggere")
    characters = len(text)
    fallback = fallback_model if fallback_model in FALLBACKS else DEFAULT_FALLBACK
    order = {"elevenlabs": ["elevenlabs"], "openrouter": ["openrouter"]}.get(provider, ["elevenlabs", "openrouter"])
    errors: list[str] = []
    for position, name in enumerate(order):
        label = "ElevenLabs" if name == "elevenlabs" else FALLBACKS[fallback]["label"]

        async def tick(fraction: float, label=label) -> None:
            if progress:
                await progress(0.1 + 0.85 * fraction, f"Voce · {label}")

        if progress:
            await progress(0.05, f"Voce · {label}" if position == 0 else f"ElevenLabs non disponibile: provo {label}")
        info = (await openrouter_models()).get(fallback) if name == "openrouter" else None
        model_hint = "eleven_multilingual_v2" if name == "elevenlabs" else fallback
        price = _price(name, model_hint, characters, info)
        tx = await billing.reserve(db, teacher, price, model_hint, provider=name)  # 402 when credits are short: no fallback helps
        started = time.time()
        try:
            if name == "elevenlabs":
                audio, model, voice = await _speak_elevenlabs(text, language, voice_id, tick)
            else:
                audio, voice = await _speak_openrouter(text, fallback, voice_id, tick)
                model = fallback
        except asyncio.CancelledError:
            await asyncio.shield(billing.settle(db, tx.id, status="refunded"))
            raise
        except HTTPException as exc:
            await billing.settle(db, tx.id, status="refunded")
            logger.warning("TTS via %s failed after %.1fs: %s", name, time.time() - started, exc.detail)
            errors.append(f"{label}: {exc.detail}")
            continue
        except Exception as exc:  # network or conversion surprises must not lose the fallback
            await billing.settle(db, tx.id, status="refunded")
            logger.exception("TTS via %s crashed", name)
            errors.append(f"{label}: {exc}")
            continue
        await billing.settle(db, tx.id, _price(name, model, characters, info))
        seconds = await billing.duration(audio)
        return SpeechResult(audio=audio, provider=name, model=model, voice=voice, characters=characters, seconds=seconds)
    raise HTTPException(502, "Sintesi vocale non riuscita (" + "; ".join(errors) + ")")
