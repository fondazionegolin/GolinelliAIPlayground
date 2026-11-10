"""Local speech-to-text with faster-whisper (CTranslate2) on the gateway GPU, for call recordings.

The model is loaded on first use, kept while there is work, and unloaded after a few idle minutes so the GPU
stays free for the rest (Toy LM). Models are cached in /app/stt_models (Docker volume): the first use of a
model downloads it from Hugging Face. Which engine/model the platform uses is an admin setting
(``platform_settings['call_transcription']``), read by services/call_recordings.py.
"""
from __future__ import annotations

import asyncio
import io
import logging
import os
import threading
import time
from pathlib import Path
from typing import Any, Optional

from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)

MODEL_DIR = Path(os.environ.get("STT_MODEL_DIR", "/app/stt_models"))
IDLE_UNLOAD_SECONDS = 10 * 60
SETTING_KEY = "call_transcription"

# Shown as-is in the selector. Sizes are the fp16 GPU footprint; speeds are measured on the RTX 4090.
MODELS: list[dict[str, Any]] = [
    {"engine": "local", "model": "large-v3-turbo", "label": "Whisper large-v3 turbo (locale)",
     "note": "Consigliato: ottimo italiano, ~1,6 GB GPU, ~45× tempo reale", "repo": "mobiuslabsgmbh/faster-whisper-large-v3-turbo"},
    {"engine": "local", "model": "large-v3", "label": "Whisper large-v3 (locale)",
     "note": "Massima accuratezza, ~3 GB GPU, circa 3 volte più lento del turbo", "repo": "Systran/faster-whisper-large-v3"},
    {"engine": "local", "model": "medium", "label": "Whisper medium (locale)",
     "note": "~1,5 GB GPU, buon compromesso, meno preciso su nomi e termini tecnici", "repo": "Systran/faster-whisper-medium"},
    {"engine": "local", "model": "small", "label": "Whisper small (locale)",
     "note": "~0,5 GB GPU, molto rapido, errori più frequenti", "repo": "Systran/faster-whisper-small"},
    {"engine": "local", "model": "base", "label": "Whisper base (locale)",
     "note": "Solo per prove: qualità bassa in italiano", "repo": "Systran/faster-whisper-base"},
    {"engine": "openai", "model": "whisper-1", "label": "OpenAI whisper-1 (cloud)",
     "note": "A pagamento (~0,006 $/min, crediti del docente), l'audio esce dalla piattaforma", "repo": None},
]
DEFAULT = {"engine": "local", "model": "large-v3-turbo"}

_lock = threading.Lock()
_loaded: dict[str, Any] = {"name": None, "model": None, "last_used": 0.0, "device": None}
_unload_task: Optional[asyncio.Task] = None


def option(engine: str, model: str) -> Optional[dict[str, Any]]:
    return next((m for m in MODELS if m["engine"] == engine and m["model"] == model), None)


def is_downloaded(model: str) -> bool:
    info = option("local", model)
    if not info or not info["repo"]:
        return False
    folder = MODEL_DIR / ("models--" + info["repo"].replace("/", "--"))
    return any(folder.glob("snapshots/*/model.bin"))


def available() -> tuple[bool, str]:
    try:
        import ctranslate2  # noqa: F401
        import faster_whisper  # noqa: F401
    except Exception as exc:  # pragma: no cover - depends on the image
        return False, f"faster-whisper non installato: {exc}"
    try:
        import ctranslate2
        if ctranslate2.get_cuda_device_count() < 1:
            return True, "Nessuna GPU visibile: il modello girerà su CPU (molto più lento)"
    except Exception:
        pass
    return True, ""


async def get_setting(db: AsyncSession) -> dict[str, str]:
    from app.models.platform_setting import PlatformSetting
    row = await db.get(PlatformSetting, SETTING_KEY)
    value = row.value if row and isinstance(row.value, dict) else {}
    chosen = {"engine": value.get("engine") or DEFAULT["engine"], "model": value.get("model") or DEFAULT["model"]}
    return chosen if option(chosen["engine"], chosen["model"]) else dict(DEFAULT)


async def set_setting(db: AsyncSession, engine: str, model: str) -> dict[str, str]:
    from app.models.platform_setting import PlatformSetting
    if not option(engine, model):
        raise ValueError("Modello di trascrizione non disponibile")
    row = await db.get(PlatformSetting, SETTING_KEY)
    if row is None:
        db.add(PlatformSetting(key=SETTING_KEY, value={"engine": engine, "model": model}))
    else:
        row.value = {"engine": engine, "model": model}
    await db.commit()
    return {"engine": engine, "model": model}


def status() -> dict[str, Any]:
    ok, note = available()
    return {
        "local_available": ok,
        "local_note": note,
        "loaded_model": _loaded["name"],
        "device": _loaded["device"],
        "downloaded": [m["model"] for m in MODELS if m["engine"] == "local" and is_downloaded(m["model"])],
    }


def _load(model: str):
    """Load (or reuse) the model. Runs in a worker thread: download + GPU upload can take a while."""
    from faster_whisper import WhisperModel
    with _lock:
        if _loaded["name"] == model and _loaded["model"] is not None:
            _loaded["last_used"] = time.monotonic()
            return _loaded["model"]
        _loaded.update(name=None, model=None)
        info = option("local", model)
        MODEL_DIR.mkdir(parents=True, exist_ok=True)
        import ctranslate2
        cuda = ctranslate2.get_cuda_device_count() > 0
        device, compute = ("cuda", "float16") if cuda else ("cpu", "int8")
        instance = WhisperModel(info["repo"] or model, device=device, compute_type=compute, download_root=str(MODEL_DIR))
        _loaded.update(name=model, model=instance, last_used=time.monotonic(), device=device)
        logger.info("local STT model %s loaded on %s", model, device)
        return instance


def _transcribe_sync(model: str, audio: bytes, language: Optional[str]) -> list[dict[str, Any]]:
    instance = _load(model)
    segments, _info = instance.transcribe(
        io.BytesIO(audio), language=language or None, vad_filter=True,
        vad_parameters={"min_silence_duration_ms": 500}, condition_on_previous_text=False,
    )
    out = [{"start": float(s.start), "end": float(s.end), "text": s.text.strip(),
            "no_speech_prob": float(getattr(s, "no_speech_prob", 0) or 0),
            "avg_logprob": float(getattr(s, "avg_logprob", 0) or 0)} for s in segments]
    _loaded["last_used"] = time.monotonic()
    return out


async def transcribe(model: str, audio: bytes, language: Optional[str] = "it") -> list[dict[str, Any]]:
    """Timestamped segments for one audio file (raw, before the hallucination filter)."""
    result = await asyncio.to_thread(_transcribe_sync, model, audio, language)
    _schedule_unload()
    return result


async def preload(model: str) -> None:
    """Download + load ahead of the first recording (called in the background from the admin selector)."""
    try:
        await asyncio.to_thread(_load, model)
        _schedule_unload()
    except Exception:
        logger.exception("preloading local STT model %s failed", model)


def _schedule_unload() -> None:
    global _unload_task
    if _unload_task and not _unload_task.done():
        return

    async def watcher() -> None:
        while _loaded["model"] is not None:
            await asyncio.sleep(60)
            if time.monotonic() - _loaded["last_used"] > IDLE_UNLOAD_SECONDS:
                with _lock:
                    name = _loaded["name"]
                    _loaded.update(name=None, model=None, device=None)
                import gc
                gc.collect()
                logger.info("local STT model %s unloaded after idle", name)

    try:
        _unload_task = asyncio.get_running_loop().create_task(watcher())
    except RuntimeError:  # pragma: no cover - no loop (tests)
        _unload_task = None
