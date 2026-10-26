"""ElevenLabs calls stay server-side; podcast scripts are reviewed before synthesis."""
import asyncio
import subprocess
import tempfile
from pathlib import Path
import time
from typing import Literal

import httpx
from fastapi import HTTPException
from pydantic import BaseModel, Field

from app.core.config import settings

BASE_URL = "https://api.elevenlabs.io"
_voice_cache: tuple[float, list[dict]] = (0, [])


class PodcastOptions(BaseModel):
    voice_id: str = Field(min_length=3, max_length=80, pattern=r"^[A-Za-z0-9_-]+$")
    duration_minutes: Literal[1, 3, 5, 10] = 3
    language: Literal["it", "en", "fr", "es", "de"] = "it"
    tone: Literal["didattico", "conversazionale", "narrativo"] = "didattico"
    audience: str = Field(default="Studenti della scuola secondaria", max_length=200)
    instructions: str = Field(default="", max_length=2000)
    speed: float = Field(default=1, ge=0.7, le=1.2)
    stability: float = Field(default=0.5, ge=0, le=1)


def api_key() -> str:
    if not settings.ELEVENLABS_API_KEY:
        raise HTTPException(503, "ElevenLabs non è ancora configurato sul server.")
    return settings.ELEVENLABS_API_KEY


def provider_error(response: httpx.Response) -> None:
    if response.is_success:
        return
    # Never relay provider bodies: they can contain billing/account identifiers.
    if response.status_code in (401, 403):
        raise HTTPException(502, "ElevenLabs: chiave non valida o permessi insufficienti. Contatta l’amministratore.")
    if response.status_code in (402, 429):
        raise HTTPException(503, "ElevenLabs: quota esaurita o servizio occupato. Riprova più tardi.")
    raise HTTPException(502, "ElevenLabs non ha completato la richiesta. Riprova.")


async def list_voices() -> list[dict]:
    global _voice_cache
    key = api_key()
    if time.monotonic() - _voice_cache[0] < 300:
        return _voice_cache[1]
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.get(f"{BASE_URL}/v2/voices", headers={"xi-api-key": key}, params={"page_size": 100})
            provider_error(response)
            voices = [{"voice_id": v["voice_id"], "name": v["name"], "labels": v.get("labels", {}),
                       "preview_url": v.get("preview_url"), "description": v.get("description", "")}
                      for v in response.json().get("voices", [])]
    except httpx.HTTPError:
        raise HTTPException(502, "Impossibile contattare ElevenLabs.")
    _voice_cache = (time.monotonic(), voices)
    return voices


def speech_chunks(text: str, limit: int = 4500) -> list[str]:
    """Split at sentence/word boundaries; each request stays below the model limit."""
    text = text.strip()
    chunks = []
    while len(text) > limit:
        cut = max(text.rfind(". ", 0, limit), text.rfind("! ", 0, limit), text.rfind("? ", 0, limit), text.rfind("\n", 0, limit))
        if cut < limit // 2:
            cut = text.rfind(" ", 0, limit)
        if cut < 1:
            cut = limit
        elif text[cut] in ".!?":
            cut += 1
        chunks.append(text[:cut].strip())
        text = text[cut:].strip()
    if text:
        chunks.append(text)
    return chunks


async def synthesize(script: str, options: PodcastOptions) -> bytes:
    key = api_key()
    if not script.strip():
        raise HTTPException(422, "Il testo del podcast è vuoto.")
    if options.voice_id not in {v["voice_id"] for v in await list_voices()}:
        raise HTTPException(422, "Scegli una voce disponibile nel tuo account ElevenLabs.")
    parts: list[bytes] = []
    previous = ""
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(240, connect=20)) as client:
            for chunk in speech_chunks(script):
                response = await client.post(
                    f"{BASE_URL}/v1/text-to-speech/{options.voice_id}",
                    headers={"xi-api-key": key, "Accept": "audio/mpeg"},
                    params={"output_format": "mp3_44100_128"},
                    json={"text": chunk, "model_id": settings.ELEVENLABS_TTS_MODEL,
                          "language_code": options.language, "previous_text": previous[-1000:] or None,
                          "voice_settings": {"stability": options.stability, "similarity_boost": 0.75,
                                             "speed": options.speed, "use_speaker_boost": True}},
                )
                provider_error(response)
                if not response.content or not response.headers.get("content-type", "").startswith("audio/"):
                    raise HTTPException(502, "ElevenLabs ha restituito un file audio non valido.")
                parts.append(response.content)
                previous = chunk
    except httpx.HTTPError:
        raise HTTPException(502, "La generazione audio è stata interrotta. Riprova.")
    return parts[0] if len(parts) == 1 else await asyncio.to_thread(join_mp3, parts)


def join_mp3(parts: list[bytes]) -> bytes:
    """Remux chunks so seeking and duration cover the complete podcast, not just chunk one."""
    with tempfile.TemporaryDirectory(prefix="podcast-") as tmp:
        root = Path(tmp)
        for i, data in enumerate(parts):
            (root / f"part-{i}.mp3").write_bytes(data)
        (root / "parts.txt").write_text("".join(f"file 'part-{i}.mp3'\n" for i in range(len(parts))))
        try:
            subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-f", "concat", "-safe", "0",
                            "-i", str(root / "parts.txt"), "-c:a", "copy", "-write_xing", "1", str(root / "podcast.mp3")],
                           check=True, capture_output=True, timeout=60)
        except (OSError, subprocess.SubprocessError):
            raise HTTPException(502, "Non è stato possibile assemblare il podcast. Riprova con una durata più breve.")
        return (root / "podcast.mp3").read_bytes()
