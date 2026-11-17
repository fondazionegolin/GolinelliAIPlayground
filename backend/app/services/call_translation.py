"""Translate a recording's summary or transcript, speak the translation, and the automatic pipeline that does both.

Built for students who do not speak Italian yet: record the teacher, transcribe, translate (summary and full
transcript) into one or more languages, optionally read them aloud, then share with the class or one student.
"""
from __future__ import annotations

import asyncio
import logging
import shutil
import uuid
from pathlib import Path
from typing import Awaitable, Callable, Optional

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import User
from app.models.voice_call import VoiceCallAnalysis, VoiceCallRecording
from app.services import call_languages, call_recordings as rec, call_tts

logger = logging.getLogger(__name__)
CHUNK_CHARS = 5000
Progress = Callable[[float, str], Awaitable[None]]
SOURCE_LABEL = {"summary": "Riassunto", "transcript": "Trascrizione"}


def _chunks(text: str) -> list[str]:
    """Split at line ends, so a transcript line is never cut in the middle."""
    parts, current = [], ""
    for line in text.split("\n"):
        if current and len(current) + len(line) + 1 > CHUNK_CHARS:
            parts.append(current)
            current = line
        else:
            current = f"{current}\n{line}" if current else line
    if current.strip():
        parts.append(current)
    return parts


async def translate_text(db: AsyncSession, teacher: Optional[User], text: str, code: str, *, keep_format: str) -> str:
    from app.services.credit_service import credit_service
    from app.services.llm_service import llm_service
    name = call_languages.language_name(code)
    system = (
        f"Sei un traduttore professionista. Traduci in {name} il testo che ricevi, dall'italiano. {keep_format} "
        "Mantieni nomi propri, numeri e formule. Non aggiungere commenti, introduzioni o note: restituisci solo la traduzione."
    )
    semaphore = asyncio.Semaphore(3)

    async def one(part: str) -> str:
        async with semaphore:
            response = await llm_service.generate(messages=[{"role": "user", "content": part}], system_prompt=system,
                                                  temperature=0.2, max_tokens=6000)
        out = (response.content or "").strip()
        if not out:
            raise HTTPException(502, "Il modello non ha prodotto una traduzione")
        try:
            prompt_tokens, completion_tokens = int(response.prompt_tokens or 0), int(response.completion_tokens or 0)
            cost = credit_service.calculate_cost_for_model(response.provider, response.model, prompt_tokens, completion_tokens, 0)
            await rec._charge(db, teacher, response.provider, response.model, cost, {
                "prompt_tokens": prompt_tokens, "completion_tokens": completion_tokens,
                "total_tokens": prompt_tokens + completion_tokens, "type": "call_recording:translation"})
        except Exception:
            logger.exception("translation cost computation failed")
        return out

    return "\n".join(await asyncio.gather(*(one(part) for part in _chunks(text))))


def audio_path(analysis: VoiceCallAnalysis) -> Optional[Path]:
    return Path("uploads") / analysis.audio_key if analysis.audio_key else None


async def delete_translation(db: AsyncSession, analysis: VoiceCallAnalysis) -> None:
    if analysis.knowledge_document_id:
        await rec.delete_knowledge_document(db, analysis.knowledge_document_id)
    path = audio_path(analysis)
    if path:
        path.unlink(missing_ok=True)
    await db.delete(analysis)


async def translate_recording(
    db: AsyncSession, recording: VoiceCallRecording, teacher: Optional[User], code: str, source: str,
) -> VoiceCallAnalysis:
    """Translate the latest summary or the whole transcript into `code`; replaces the previous one of the same kind."""
    if code not in call_languages.BY_CODE:
        raise HTTPException(422, "Lingua non disponibile")
    if source == "summary":
        summary = (await db.execute(select(VoiceCallAnalysis).where(
            VoiceCallAnalysis.recording_id == recording.id, VoiceCallAnalysis.kind == "summary")
            .order_by(VoiceCallAnalysis.created_at.desc()).limit(1))).scalars().first()
        if not summary:
            raise HTTPException(409, "Genera prima il riassunto")
        text, hint = summary.content, "Il testo è Markdown: conserva titoli, elenchi ed enfasi."
    elif source == "transcript":
        text = rec.transcript_text(recording)
        if not text.strip():
            raise HTTPException(409, "La trascrizione è vuota")
        hint = "Ogni riga è «[tempo] Nome: frase»: conserva tempo e nome di chi parla, traduci solo la frase."
    else:
        raise HTTPException(422, "Sorgente non valida")
    translated = await translate_text(db, teacher, text, code, keep_format=hint)
    for old in (await db.execute(select(VoiceCallAnalysis).where(
            VoiceCallAnalysis.recording_id == recording.id, VoiceCallAnalysis.kind == "translation",
            VoiceCallAnalysis.language == code, VoiceCallAnalysis.source_kind == source))).scalars().all():
        await delete_translation(db, old)
    name = call_languages.language_name(code)
    analysis = VoiceCallAnalysis(
        recording_id=recording.id, kind="translation", title=f"{SOURCE_LABEL[source]} · {name}", content=translated,
        language=code, source_kind=source, created_by_teacher_id=teacher.id if teacher else None,
    )
    db.add(analysis)
    await db.commit()
    await db.refresh(analysis)
    return analysis


async def speak_analysis(
    db: AsyncSession, recording: VoiceCallRecording, teacher: User, analysis: VoiceCallAnalysis, *,
    voice_id: Optional[str] = None, provider: str = "auto", fallback_model: Optional[str] = None,
    progress: Optional[Progress] = None,
) -> VoiceCallAnalysis:
    """Read the analysis aloud (translation language, or Italian for a summary) and keep the MP3 next to the recording."""
    language = analysis.language or call_languages.SOURCE["code"]
    result = await call_tts.synthesize(db, teacher, analysis.content, language, voice_id=voice_id, provider=provider,
                                       fallback_model=fallback_model, progress=progress)
    folder = rec.storage_dir(recording.id) / "speech"
    folder.mkdir(parents=True, exist_ok=True)
    previous = audio_path(analysis)
    key = f"call_recordings/{recording.id}/speech/{analysis.id}-{uuid.uuid4().hex[:8]}.mp3"
    (Path("uploads") / key).write_bytes(result.audio)
    if previous:
        previous.unlink(missing_ok=True)
    analysis.audio_key, analysis.audio_provider = key, f"{result.provider}:{result.model}"
    analysis.audio_voice, analysis.audio_seconds = result.voice, round(result.seconds, 1)
    await db.commit()
    return analysis


async def run_pipeline(db: AsyncSession, recording: VoiceCallRecording, teacher: Optional[User], progress: Optional[Progress] = None) -> list[str]:
    """After transcription: translate summary and transcript into each chosen language, then speak them if asked."""
    config = recording.pipeline or {}
    languages = [c for c in config.get("languages") or [] if c in call_languages.BY_CODE]
    notes: list[str] = []
    steps = max(1, len(languages) * (4 if config.get("speech") else 2))
    done = 0

    async def step(label: str) -> None:
        nonlocal done
        done += 1
        if progress:
            await progress(0.92 + 0.07 * done / steps, label)

    for code in languages:
        name = call_languages.language_name(code)
        made: list[VoiceCallAnalysis] = []
        for source in ("summary", "transcript"):
            try:
                made.append(await translate_recording(db, recording, teacher, code, source))
            except HTTPException as exc:
                notes.append(f"{SOURCE_LABEL[source]} in {name}: {exc.detail}")
            await step(f"Traduzione in {name}")
        if config.get("speech") and teacher:
            for analysis in made:
                try:
                    await speak_analysis(db, recording, teacher, analysis, voice_id=config.get("voice_id"),
                                         provider=config.get("provider") or "auto", fallback_model=config.get("fallback_model"))
                except HTTPException as exc:
                    notes.append(f"Voce {SOURCE_LABEL[analysis.source_kind or 'summary'].lower()} in {name}: {exc.detail}")
                await step(f"Voce in {name}")
    return notes


def remove_recording_audio(recording_id) -> None:
    shutil.rmtree(rec.storage_dir(recording_id) / "speech", ignore_errors=True)
