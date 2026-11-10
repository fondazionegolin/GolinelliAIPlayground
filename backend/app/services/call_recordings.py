"""Call recordings → transcript with speakers → AI tools → session knowledge.

Capture happens in the browser of the moderator who starts the recording: every LiveKit audio track (one per
participant) is recorded on its own and uploaded in standalone segments of a few minutes, tagged with the
participant identity, display name and the offset from the recording start. Because each file holds a single
speaker, speaker identification is exact (no diarization guesswork).

After `stop`, a background job transcribes every segment (Whisper, segment timestamps), shifts the timestamps by
the segment offset, merges all speakers on one timeline, computes participation stats, writes a summary and
indexes transcript + summary in the session knowledge (RAG documents, scope SESSION) when the call is bound to a
session. Teachers then run more tools (synthesis, didactic analysis, questions, free prompt) from the session
«Chiamate» log; every output can be added to the knowledge too.
"""
from __future__ import annotations

import asyncio
import logging
import re
import shutil
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import AsyncSessionLocal
from app.models.enums import DocumentStatus, Scope
from app.models.rag import RAGDocument
from app.models.user import User
from app.models.voice_call import VoiceCall, VoiceCallAnalysis, VoiceCallRecording, VoiceCallRecordingSegment

logger = logging.getLogger(__name__)

STORAGE_ROOT = Path("uploads/call_recordings")
WHISPER_USD_PER_MINUTE = 0.006
MAX_SEGMENT_BYTES = 40 * 1024 * 1024
MAX_TRANSCRIPT_CHARS = 180_000
MERGE_GAP_SECONDS = 2.5
# Whisper invents these on silence or noise: drop them.
_HALLUCINATIONS = re.compile(
    r"(sottotitoli (creati|a cura) |amara\.org|grazie per la visione|iscriviti al canale|thanks for watching|"
    r"sottotitoli e revisione|www\.|^\W*$)", re.IGNORECASE,
)

TOOLS: dict[str, dict[str, str]] = {
    "summary": {
        "title": "Riassunto",
        "prompt": "Scrivi un riassunto chiaro della videochiamata in 8-12 frasi: di cosa si è parlato, in che ordine, "
                  "con quali conclusioni. Cita chi ha detto le cose importanti.",
    },
    "synthesis": {
        "title": "Sintesi: punti chiave, decisioni, compiti",
        "prompt": "Produci una sintesi operativa in Markdown con quattro sezioni: «Punti chiave» (elenco), «Concetti "
                  "spiegati» (con una riga di spiegazione ciascuno), «Decisioni prese», «Compiti e prossimi passi» (chi, "
                  "cosa, entro quando se detto). Ometti le sezioni vuote.",
    },
    "analysis": {
        "title": "Analisi didattica",
        "prompt": "Fai un'analisi didattica della lezione per il docente, in Markdown: partecipazione (chi è intervenuto, "
                  "quanto, chi non è intervenuto affatto, usando le statistiche fornite), qualità degli interventi degli "
                  "studenti, segnali di comprensione e di difficoltà, misconcezioni emerse con citazioni brevi, equilibrio "
                  "tra parlato del docente e degli studenti, e 3 suggerimenti concreti per la prossima lezione. Sii "
                  "rispettoso: non dare giudizi sulle persone, solo su ciò che è emerso nella conversazione.",
    },
    "questions": {
        "title": "Domande e dubbi emersi",
        "prompt": "Elenca in Markdown tutte le domande e i dubbi espressi durante la chiamata (chi li ha posti e se hanno "
                  "avuto risposta), poi proponi 5 domande di verifica per la classe sugli argomenti trattati, con la "
                  "risposta attesa.",
    },
    "custom": {"title": "Domanda sulla chiamata", "prompt": ""},
}


def storage_dir(recording_id) -> Path:
    return STORAGE_ROOT / str(recording_id)


def fmt_clock(seconds: float) -> str:
    seconds = max(0, int(seconds))
    hours, rest = divmod(seconds, 3600)
    minutes, secs = divmod(rest, 60)
    return f"{hours}:{minutes:02d}:{secs:02d}" if hours else f"{minutes:02d}:{secs:02d}"


def transcript_text(recording: VoiceCallRecording) -> str:
    return "\n".join(
        f"[{fmt_clock(line.get('start', 0))}] {line.get('speaker', '?')}: {line.get('text', '')}"
        for line in (recording.transcript or [])
    )


def participants_text(recording: VoiceCallRecording) -> str:
    rows = recording.participants or []
    return "\n".join(
        f"- {p['name']} ({'docente' if p.get('role') == 'teacher' else 'studente'}): {fmt_clock(p.get('seconds', 0))} "
        f"di parlato, {p.get('turns', 0)} interventi, {p.get('words', 0)} parole"
        for p in rows
    ) or "- nessun intervento rilevato"


async def save_segment(
    db: AsyncSession, recording: VoiceCallRecording, data: bytes, *, identity: str, name: str,
    offset_ms: int, duration_ms: int, extension: str = "webm",
) -> VoiceCallRecordingSegment:
    folder = storage_dir(recording.id)
    folder.mkdir(parents=True, exist_ok=True)
    segment_id = uuid.uuid4()
    key = f"call_recordings/{recording.id}/{segment_id}.{extension}"
    (Path("uploads") / key).write_bytes(data)
    segment = VoiceCallRecordingSegment(
        id=segment_id, recording_id=recording.id, identity=identity[:200], speaker_name=(name or "Partecipante")[:200],
        offset_ms=max(0, offset_ms), duration_ms=max(0, duration_ms), storage_key=key,
    )
    db.add(segment)
    await db.commit()
    return segment


EBML_MAGIC = bytes.fromhex("1a45dfa3")
CLUSTER_ID = bytes.fromhex("1f43b675")


async def _ffmpeg_to_ogg(data: bytes) -> Optional[bytes]:
    """Re-encode any browser recording to 16 kHz mono Opus (what speech models want). None if unreadable."""
    proc = await asyncio.create_subprocess_exec(
        "ffmpeg", "-hide_banner", "-loglevel", "error", "-i", "pipe:0", "-vn", "-ac", "1", "-ar", "16000",
        "-c:a", "libopus", "-b:a", "32k", "-f", "ogg", "pipe:1",
        stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
    )
    out, _err = await proc.communicate(data)
    return out if proc.returncode == 0 and len(out) > 200 else None


async def normalized_audio(path: Path, header_donor: Optional[Path] = None) -> bytes:
    """Readable 16 kHz mono audio for a segment.

    A segment that lost its webm header (older recorder bug: it starts straight with audio clusters) is
    rebuilt by prefixing the header of a valid segment of the same speaker, which shares codec settings.
    """
    data = path.read_bytes()
    out = await _ffmpeg_to_ogg(data)
    if out:
        return out
    if not data.startswith(EBML_MAGIC) and header_donor is not None:
        donor = header_donor.read_bytes()
        cut = donor.find(CLUSTER_ID)
        if cut > 0:
            out = await _ffmpeg_to_ogg(donor[:cut] + data)
            if out:
                return out
    raise ValueError("file audio illeggibile")


def clean_segments(raw: list[dict[str, Any]], full_text: str = "", duration: float = 0.0) -> list[dict[str, Any]]:
    """Drop empty lines, known silence hallucinations and low-confidence noise."""
    out = []
    for seg in raw:
        text = (seg.get("text") or "").strip()
        if not text or _HALLUCINATIONS.search(text):
            continue
        if float(seg.get("no_speech_prob") or 0) > 0.6 and float(seg.get("avg_logprob") or 0) < -0.8:
            continue
        out.append({"start": float(seg.get("start") or 0), "end": float(seg.get("end") or 0), "text": text})
    if not out and full_text.strip() and not _HALLUCINATIONS.search(full_text):
        out.append({"start": 0.0, "end": duration, "text": full_text.strip()})
    return out


async def _openai_segments(audio: bytes, name: str) -> list[dict[str, Any]]:
    api_key = getattr(settings, "OPENAI_API_KEY", None)
    if not api_key:
        raise RuntimeError("Trascrizione OpenAI non configurata (manca la chiave)")
    async with httpx.AsyncClient(timeout=180.0) as client:
        response = await client.post(
            "https://api.openai.com/v1/audio/transcriptions",
            headers={"Authorization": f"Bearer {api_key}"},
            files={"file": (f"{name}.ogg", audio, "audio/ogg")},
            # whisper-1 is the OpenAI model that returns segment timestamps (needed for the timeline).
            data={"model": "whisper-1", "response_format": "verbose_json", "timestamp_granularities[]": "segment"},
        )
        if response.status_code >= 400:
            raise ValueError(f"trascrizione rifiutata ({response.status_code}): {response.text[:200]}")
        payload = response.json()
    return clean_segments(payload.get("segments") or [], payload.get("text") or "", float(payload.get("duration") or 0))


async def transcribe_segment(path: Path, header_donor: Optional[Path], engine: dict[str, str]) -> list[dict[str, Any]]:
    from app.services import local_stt
    audio = await normalized_audio(path, header_donor)
    if engine["engine"] == "local":
        return clean_segments(await local_stt.transcribe(engine["model"], audio, "it"))
    return await _openai_segments(audio, path.stem)


def merge_timeline(segments: list[VoiceCallRecordingSegment]) -> tuple[list[dict], list[dict]]:
    """All speakers on one timeline; consecutive lines of the same speaker close in time become one turn."""
    lines = []
    for segment in segments:
        base = segment.offset_ms / 1000.0
        for item in segment.transcript or []:
            lines.append({
                "speaker": segment.speaker_name, "identity": segment.identity,
                "start": round(base + item["start"], 2), "end": round(base + item["end"], 2), "text": item["text"],
            })
    lines.sort(key=lambda line: line["start"])
    merged: list[dict] = []
    for line in lines:
        last = merged[-1] if merged else None
        if last and last["identity"] == line["identity"] and line["start"] - last["end"] <= MERGE_GAP_SECONDS:
            last["text"] = f"{last['text']} {line['text']}"
            last["end"] = max(last["end"], line["end"])
        else:
            merged.append(dict(line))
    stats: dict[str, dict] = {}
    for segment in segments:
        stats.setdefault(segment.identity, {
            "identity": segment.identity, "name": segment.speaker_name,
            "role": "teacher" if segment.identity.startswith("teacher:") else "student",
            "seconds": 0.0, "turns": 0, "words": 0,
        })
    for line in merged:
        entry = stats[line["identity"]]
        entry["seconds"] += max(0.0, line["end"] - line["start"])
        entry["turns"] += 1
        entry["words"] += len(line["text"].split())
    participants = sorted(stats.values(), key=lambda p: (p["role"] != "teacher", -p["seconds"]))
    for entry in participants:
        entry["seconds"] = round(entry["seconds"], 1)
    return merged, participants


async def _charge(db: AsyncSession, teacher: Optional[User], provider: str, model: str, cost: float, usage: dict) -> None:
    from app.services.credit_service import credit_service
    if not teacher or not teacher.tenant_id or cost <= 0:
        return
    try:
        await credit_service.track_usage(db, teacher.tenant_id, provider, model, cost, usage, teacher.id)
    except Exception:
        logger.exception("call recording usage tracking failed")


async def add_to_knowledge(db: AsyncSession, recording: VoiceCallRecording, title: str, text: str, doc_type: str) -> Optional[uuid.UUID]:
    """Index a text in the knowledge of the recording's session (RAG, scope SESSION)."""
    from app.services.rag_service import rag_service
    if not recording.session_id or not text.strip():
        return None
    call = await db.get(VoiceCall, recording.call_id) if recording.call_id else None
    document = RAGDocument(
        tenant_id=recording.tenant_id, scope=Scope.SESSION, session_id=recording.session_id,
        owner_teacher_id=call.owner_teacher_id if call else recording.started_by_teacher_id,
        title=title[:250], doc_type=doc_type, status=DocumentStatus.QUEUED,
    )
    db.add(document)
    await db.commit()
    await db.refresh(document)
    try:
        await rag_service.ingest_document(db, document, text)
    except Exception:
        logger.exception("knowledge ingestion failed for recording %s", recording.id)
    return document.id


async def run_tool(
    db: AsyncSession, recording: VoiceCallRecording, teacher: Optional[User], kind: str,
    prompt: Optional[str] = None, add_knowledge: bool = True,
) -> VoiceCallAnalysis:
    from app.services.credit_service import credit_service
    from app.services.llm_service import llm_service
    tool = TOOLS.get(kind)
    if not tool:
        raise ValueError("Strumento non disponibile")
    instruction = (prompt or "").strip() if kind == "custom" else tool["prompt"]
    if not instruction:
        raise ValueError("Scrivi la domanda da fare sulla chiamata")
    text = transcript_text(recording)
    if not text.strip():
        raise ValueError("La trascrizione è vuota: non c'è nulla da analizzare")
    if len(text) > MAX_TRANSCRIPT_CHARS:
        text = text[: MAX_TRANSCRIPT_CHARS // 2] + "\n[…]\n" + text[-MAX_TRANSCRIPT_CHARS // 2:]
    when = recording.started_at.astimezone().strftime("%d/%m/%Y %H:%M") if recording.started_at else ""
    system = ("Sei un assistente didattico. Lavori sulla trascrizione di una videochiamata di classe; ogni riga ha "
              "l'orario e il nome di chi parla. Rispondi in italiano, in Markdown, basandoti solo sulla trascrizione.")
    user = (f"Videochiamata: {recording.title} ({when})\n\nPartecipazione:\n{participants_text(recording)}\n\n"
            f"Trascrizione:\n{text}\n\nCompito:\n{instruction}")
    response = await llm_service.generate(messages=[{"role": "user", "content": user}], system_prompt=system,
                                          temperature=0.3, max_tokens=2500)
    content = (response.content or "").strip()
    if not content:
        raise ValueError("Il modello non ha prodotto una risposta")
    try:
        prompt_tokens, completion_tokens = int(response.prompt_tokens or 0), int(response.completion_tokens or 0)
        cost = credit_service.calculate_cost_for_model(response.provider, response.model, prompt_tokens, completion_tokens, 0)
        await _charge(db, teacher, response.provider, response.model, cost, {
            "prompt_tokens": prompt_tokens, "completion_tokens": completion_tokens,
            "total_tokens": prompt_tokens + completion_tokens, "type": f"call_recording:{kind}",
        })
    except Exception:
        logger.exception("call tool cost computation failed")
    title = tool["title"] if kind != "custom" else f"Domanda: {instruction[:120]}"
    analysis = VoiceCallAnalysis(
        recording_id=recording.id, kind=kind, title=title, prompt=instruction if kind == "custom" else None,
        content=content, created_by_teacher_id=teacher.id if teacher else None,
    )
    db.add(analysis)
    await db.commit()
    await db.refresh(analysis)
    if add_knowledge:
        analysis.knowledge_document_id = await add_to_knowledge(
            db, recording, f"{title} · {recording.title} ({when})", content, f"call_{kind}")
        await db.commit()
    return analysis


async def share_to_session(db: AsyncSession, recording: VoiceCallRecording, analysis: VoiceCallAnalysis, teacher: User) -> None:
    """Post a result (summary, synthesis…) in the class chat of the recording's session as a readable card."""
    from app.models.chat import ChatMessage
    from app.models.enums import SenderType
    from app.models.session import Session
    from app.realtime.gateway import sio
    from app.services.calendar_reminders import _public_room
    from app.services.calendar_service import teacher_name

    session = await db.get(Session, recording.session_id) if recording.session_id else None
    if not session:
        raise ValueError("La chiamata non è collegata a una sessione")
    room = await _public_room(db, session)
    data = {
        "title": analysis.title, "recording_title": recording.title, "recording_id": str(recording.id),
        "content": analysis.content[:8000],
    }
    text = f"📝 {analysis.title} · {recording.title}"
    message = ChatMessage(
        tenant_id=session.tenant_id, session_id=session.id, room_id=room.id,
        sender_type=SenderType.TEACHER, sender_teacher_id=teacher.id, message_text=text[:300],
        attachments={"is_notification": True, "notification_type": "call_summary", "notification_data": data},
    )
    db.add(message)
    await db.commit()
    await sio.emit("chat_message", {
        "room_type": "PUBLIC", "session_id": str(session.id),
        "message": {
            "id": str(message.id), "sender_type": "TEACHER", "sender_id": str(teacher.id), "sender_name": teacher_name(teacher),
            "text": text[:300], "attachments": [], "created_at": datetime.now(timezone.utc).isoformat(),
            "is_notification": True, "notification_type": "call_summary", "notification_data": data,
        },
    }, room=f"session:{session.id}")


async def process_recording(recording_id: uuid.UUID, ctx=None) -> dict:
    """Background job: transcribe every segment, merge, summary, knowledge."""
    async with AsyncSessionLocal() as db:
        recording = await db.get(VoiceCallRecording, recording_id)
        if not recording:
            return {"status": "missing"}
        teacher = await db.get(User, recording.started_by_teacher_id) if recording.started_by_teacher_id else None
        try:
            from app.services import local_stt
            engine = await local_stt.get_setting(db)
            if engine["engine"] == "local" and not local_stt.available()[0]:
                logger.warning("local STT unavailable, falling back to OpenAI for recording %s", recording_id)
                engine = {"engine": "openai", "model": "whisper-1"}
            recording.transcription_model = f"{engine['engine']}:{engine['model']}"
            await db.commit()
            segments = list((await db.execute(
                select(VoiceCallRecordingSegment).where(VoiceCallRecordingSegment.recording_id == recording.id)
                .order_by(VoiceCallRecordingSegment.offset_ms)
            )).scalars().all())
            # One GPU model: local segments go one at a time (each takes a few seconds); the cloud takes 3 in parallel.
            semaphore = asyncio.Semaphore(1 if engine["engine"] == "local" else 3)
            done = 0
            failed: list[str] = []
            # First segment of each speaker starts with a webm header: donor for segments that lost theirs.
            donors: dict[str, Path] = {}
            for segment in segments:
                path = Path("uploads") / segment.storage_key
                if segment.identity not in donors and path.exists() and path.read_bytes()[:4] == EBML_MAGIC:
                    donors[segment.identity] = path

            async def transcribe(segment: VoiceCallRecordingSegment) -> None:
                nonlocal done
                if segment.transcript is not None:
                    done += 1
                    return
                async with semaphore:
                    try:
                        segment.transcript = await transcribe_segment(
                            Path("uploads") / segment.storage_key, donors.get(segment.identity), engine)
                    except Exception as exc:  # one bad segment must not sink the whole recording
                        logger.warning("segment %s of recording %s not transcribed: %s", segment.id, recording_id, exc)
                        failed.append(f"{segment.speaker_name} @ {fmt_clock(segment.offset_ms / 1000)}")
                done += 1
                if ctx is not None:
                    await ctx.progress(0.8 * done / max(1, len(segments)), f"Trascrizione {done}/{len(segments)}")

            await asyncio.gather(*(transcribe(segment) for segment in segments))
            await db.commit()
            if engine["engine"] == "openai":  # local transcription is free
                minutes = sum(segment.duration_ms for segment in segments) / 60000.0
                await _charge(db, teacher, "openai", "whisper-1", round(minutes * WHISPER_USD_PER_MINUTE, 6),
                              {"audio_minutes": round(minutes, 2), "type": "call_recording:transcription"})

            recording.transcript, recording.participants = merge_timeline(segments)
            await db.commit()
            when = recording.started_at.astimezone().strftime("%d/%m/%Y %H:%M") if recording.started_at else ""
            if recording.transcript:
                if ctx is not None:
                    await ctx.progress(0.85, "Indicizzazione nella knowledge di sessione", force=True)
                # Re-processing (retry): replace the previous transcript and automatic summary, never duplicate them.
                if recording.knowledge_document_id:
                    await delete_knowledge_document(db, recording.knowledge_document_id)
                    recording.knowledge_document_id = None
                for old in (await db.execute(select(VoiceCallAnalysis).where(
                        VoiceCallAnalysis.recording_id == recording.id, VoiceCallAnalysis.kind == "summary",
                        VoiceCallAnalysis.created_by_teacher_id.is_(None) | (VoiceCallAnalysis.prompt.is_(None))))).scalars().all():
                    if old.knowledge_document_id:
                        await delete_knowledge_document(db, old.knowledge_document_id)
                    await db.delete(old)
                await db.commit()
                header = f"Trascrizione della videochiamata «{recording.title}» del {when}\nPartecipanti:\n{participants_text(recording)}\n\n"
                recording.knowledge_document_id = await add_to_knowledge(
                    db, recording, f"Trascrizione · {recording.title} ({when})", header + transcript_text(recording), "call_transcript")
                await db.commit()
                if ctx is not None:
                    await ctx.progress(0.92, "Riassunto", force=True)
                try:
                    await run_tool(db, recording, teacher, "summary")
                except Exception:
                    logger.exception("automatic summary failed for recording %s", recording.id)
            recording.status = "ready"
            notes = []
            if failed:
                notes.append(f"{len(failed)} segmenti non trascritti ({', '.join(failed[:5])}{'…' if len(failed) > 5 else ''}): usa «Riprova» per ritentarli")
            if not recording.transcript:
                notes.append("Nessun parlato riconosciuto nella registrazione")
            recording.error_message = "; ".join(notes) or None
            await db.commit()
            return {"status": "ready", "lines": len(recording.transcript or [])}
        except Exception as exc:
            logger.exception("processing of recording %s failed", recording_id)
            await db.rollback()
            recording = await db.get(VoiceCallRecording, recording_id)
            if recording:
                recording.status = "failed"
                recording.error_message = str(getattr(exc, "detail", None) or exc)[:1000]
                await db.commit()
            raise


async def delete_recording(db: AsyncSession, recording: VoiceCallRecording) -> None:
    doc_ids = [recording.knowledge_document_id] + [a.knowledge_document_id for a in (await db.execute(
        select(VoiceCallAnalysis).where(VoiceCallAnalysis.recording_id == recording.id))).scalars().all()]
    for doc_id in filter(None, doc_ids):
        await delete_knowledge_document(db, doc_id)
    await db.delete(recording)
    await db.commit()
    shutil.rmtree(storage_dir(recording.id), ignore_errors=True)


async def delete_knowledge_document(db: AsyncSession, doc_id: uuid.UUID) -> None:
    from sqlalchemy import delete
    from app.models.rag import RAGChunk, RAGEmbedding
    chunk_ids = select(RAGChunk.id).where(RAGChunk.document_id == doc_id)
    await db.execute(delete(RAGEmbedding).where(RAGEmbedding.chunk_id.in_(chunk_ids)))
    await db.execute(delete(RAGChunk).where(RAGChunk.document_id == doc_id))
    document = await db.get(RAGDocument, doc_id)
    if document:
        await db.delete(document)
    await db.flush()


def serialize_recording(recording: VoiceCallRecording, *, call: Optional[VoiceCall] = None,
                        analyses: Optional[list[VoiceCallAnalysis]] = None, full: bool = False) -> dict:
    out = {
        "id": str(recording.id),
        "call_id": str(recording.call_id) if recording.call_id else None,
        "call_title": call.title if call else None,
        "call_code": call.code if call else None,
        "session_id": str(recording.session_id) if recording.session_id else None,
        "title": recording.title,
        "status": recording.status,
        "started_at": recording.started_at.isoformat() if recording.started_at else None,
        "ended_at": recording.ended_at.isoformat() if recording.ended_at else None,
        "duration_seconds": recording.duration_seconds,
        "participants": recording.participants or [],
        "lines": len(recording.transcript or []),
        "in_knowledge": bool(recording.knowledge_document_id),
        "error_message": recording.error_message,
        "transcription_model": recording.transcription_model,
    }
    if analyses is not None:
        out["analyses"] = [{
            "id": str(a.id), "kind": a.kind, "title": a.title, "prompt": a.prompt, "content": a.content,
            "in_knowledge": bool(a.knowledge_document_id), "created_at": a.created_at.isoformat() if a.created_at else None,
        } for a in analyses]
    if full:
        out["transcript"] = recording.transcript or []
    return out


def now_utc() -> datetime:
    return datetime.now(timezone.utc)
