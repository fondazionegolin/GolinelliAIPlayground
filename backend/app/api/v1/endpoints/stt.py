"""
Speech-to-Text endpoint.

POST /stt/transcribe  – OpenAI Whisper transcription
POST /stt/translate   – LLM-based translation of transcribed text
"""

import logging
from typing import Annotated, Optional

import httpx
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status

from app.api.deps import get_student_or_teacher, StudentOrTeacher
from app.core.config import settings
from app.services.llm_service import llm_service

logger = logging.getLogger(__name__)

router = APIRouter()

_LANG_NAMES: dict[str, str] = {
    "it": "Italian",
    "en": "English",
    "fr": "French",
    "de": "German",
    "es": "Spanish",
    "pt": "Portuguese",
    "zh": "Chinese",
    "ar": "Arabic",
    "ja": "Japanese",
    "ru": "Russian",
}


@router.post("/transcribe")
async def transcribe_audio(
    file: UploadFile = File(...),
    language: Optional[str] = Form(None),
    auth: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)] = None,
):
    """
    Transcribe audio using OpenAI Whisper.

    Accepts any audio format supported by Whisper (webm, mp4, mp3, wav, ogg…).
    Returns detected language, transcription text, and duration.
    """
    api_key = getattr(settings, "OPENAI_API_KEY", None)
    if not api_key:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="OpenAI API not configured",
        )

    audio_bytes = await file.read()
    if not audio_bytes:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Empty audio file"
        )

    filename = file.filename or "recording.webm"
    content_type = file.content_type or "audio/webm"

    extra: dict = {}
    if language and language != "auto":
        extra["language"] = language

    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            response = await client.post(
                "https://api.openai.com/v1/audio/transcriptions",
                headers={"Authorization": f"Bearer {api_key}"},
                files={"file": (filename, audio_bytes, content_type)},
                data={"model": "whisper-1", "response_format": "verbose_json", **extra},
            )
            response.raise_for_status()
            result = response.json()

        return {
            "text": (result.get("text") or "").strip(),
            "language": result.get("language", ""),
            "duration": round(result.get("duration", 0.0), 2),
        }

    except httpx.HTTPStatusError as e:
        logger.error("[STT] Whisper API error %s: %s", e.response.status_code, e.response.text)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Transcription service error",
        )
    except Exception as e:
        logger.error("[STT] Transcription error: %s", e)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e)
        )


@router.post("/translate")
async def translate_text(
    body: dict,
    auth: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
):
    """
    Translate text to the requested target language using the configured LLM.
    Body: { text, source_language?, target_language }
    """
    text = (body.get("text") or "").strip()
    target_lang = body.get("target_language", "it")

    if not text:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Empty text"
        )

    target_name = _LANG_NAMES.get(target_lang, target_lang)

    try:
        response = await llm_service.generate(
            messages=[
                {
                    "role": "user",
                    "content": (
                        f"Translate the following text to {target_name}. "
                        "Return ONLY the translated text, no explanations.\n\n"
                        f"{text}"
                    ),
                }
            ],
            system_prompt=(
                "You are a professional translator. "
                "Return only the translated text without any explanation or extra formatting."
            ),
            temperature=0.1,
            max_tokens=1000,
        )
        return {"translated_text": response.content.strip()}

    except Exception as e:
        logger.error("[STT] Translation error: %s", e)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Translation failed",
        )
