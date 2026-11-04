"""Teacher-only ElevenLabs audio workspace and private saved library."""
import asyncio
import base64
import hashlib
import json
from typing import Annotated, Literal
from urllib.parse import quote
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, File as UploadField, Form, HTTPException, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel, ConfigDict, Field, ValidationError, model_validator
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_teacher
from app.core.config import settings
from app.core.database import get_db
from app.models.user import User
from app.models.voice_lab import VoiceLabItem
from app.models.file import File
from app.models.drive import DriveItem
from app.models.enums import OwnerType, Scope
from app.services import drive_service as drive, voice_lab as eleven, voice_lab_billing as billing
from app.services.credit_service import credit_service

router = APIRouter()
Teacher = Annotated[User, Depends(get_current_teacher)]
Db = Annotated[AsyncSession, Depends(get_db)]
MAX_BYTES = 50 * 1024 * 1024
VoiceId = Annotated[str, Field(pattern=r"^[A-Za-z0-9_-]{1,120}$")]


class DialogueLine(BaseModel):
    text: str = Field(min_length=1, max_length=2000)
    voice_id: VoiceId


class Generation(BaseModel):
    model_config = ConfigDict(extra="forbid", protected_namespaces=())
    action: Literal["tts", "dialogue", "convert", "transcribe", "isolate", "sound_effects", "music", "alignment", "dubbing"]
    title: str = Field(default="Nuovo audio", min_length=1, max_length=200)
    text: str = Field(default="", max_length=20000)
    voice_id: VoiceId | None = None
    model_id: VoiceId | None = None
    language: str = Field(default="it", pattern=r"^[a-z]{2,3}$")
    source_language: str = Field(default="auto", pattern=r"^(auto|[a-z]{2,3})$")
    output_format: Literal["mp3_44100_128", "mp3_44100_192", "wav_44100", "opus_48000_128"] = "mp3_44100_128"
    stability: float = Field(default=0.5, ge=0, le=1)
    similarity: float = Field(default=0.75, ge=0, le=1)
    speed: float = Field(default=1, ge=0.7, le=1.2)
    seconds: int = Field(default=10, ge=1, le=600)
    instrumental: bool = True
    diarize: bool = False
    remove_noise: bool = False
    dialogue: list[DialogueLine] = Field(default_factory=list, max_length=50)

    @model_validator(mode="after")
    def validate_action(self):
        if self.action in {"tts", "alignment", "sound_effects", "music"} and not self.text.strip():
            raise ValueError("Inserisci il testo o la descrizione")
        if self.action in {"tts", "convert"} and not self.voice_id:
            raise ValueError("Scegli una voce")
        if self.action == "dialogue" and (not self.dialogue or sum(len(v.text) for v in self.dialogue) > 2000 or len({v.voice_id for v in self.dialogue}) > 10):
            raise ValueError("Il dialogo richiede battute, al massimo 2000 caratteri e 10 voci")
        if self.action == "music" and not 3 <= self.seconds <= 600:
            raise ValueError("La musica deve durare da 3 a 600 secondi")
        if self.action == "music" and len(self.text) > 4100:
            raise ValueError("La descrizione musicale può contenere al massimo 4100 caratteri")
        if self.action == "sound_effects" and self.seconds > 30:
            raise ValueError("Gli effetti possono durare al massimo 30 secondi")
        return self


class VoiceDesign(BaseModel):
    description: str = Field(min_length=20, max_length=1000)
    text: str = Field(default="", max_length=1000)
    remix_voice_id: VoiceId | None = None

    @model_validator(mode="after")
    def text_length(self):
        if self.text and len(self.text) < 100:
            raise ValueError("Il testo di prova deve contenere almeno 100 caratteri oppure essere lasciato vuoto")
        return self


class VoiceSave(BaseModel):
    preview_id: UUID
    name: str = Field(min_length=1, max_length=100)


def serialize(item: VoiceLabItem, full: bool = False):
    details = item.details or {}
    return {"id": str(item.id), "title": item.title, "kind": item.kind, "service": item.service,
            "voice_id": item.provider_id if item.kind == "voice" else None,
            "status": details.get("status", "ready"), "mime_type": item.mime_type,
            "created_at": item.created_at.isoformat() if item.created_at else None,
            "content_url": f"/api/v1/voice-lab/items/{item.id}/content" if item.storage_key else None,
            "details": details if full else {k: v for k, v in details.items() if k in {"size_bytes", "characters", "status", "language", "requires_verification", "drive_item_id", "credits", "pricing", "duration_seconds"}}}


async def owned(db: AsyncSession, teacher: User, item_id: UUID, *, lock=False) -> VoiceLabItem:
    query = select(VoiceLabItem).where(VoiceLabItem.id == item_id, VoiceLabItem.owner_id == teacher.id, VoiceLabItem.tenant_id == teacher.tenant_id)
    item = await db.scalar(query.with_for_update() if lock else query)
    if not item:
        raise HTTPException(404, "Elemento non trovato")
    return item


async def visible_voices(db: AsyncSession, teacher: User) -> list[dict]:
    return await eleven.visible_voices(db, teacher)


async def require_voices(db, teacher, ids: set[str]):
    allowed = {v["voice_id"] for v in await visible_voices(db, teacher)}
    if not ids.issubset(allowed):
        raise HTTPException(422, "Scegli una voce disponibile nella tua libreria")


async def save_blob(db, teacher, title, service, data: bytes, mime: str, ext: str, details: dict, *, kind="audio", provider_id=None):
    used = await drive.drive_usage_bytes(db, teacher.id)
    if used + len(data) > settings.DRIVE_QUOTA_MB * 1024 * 1024:
        raise HTTPException(413, "Spazio nei Files insufficiente per salvare questo risultato")
    item_id, file_id, drive_id = uuid4(), uuid4(), uuid4()
    name = f"{title[:160].replace('/', '-').replace(chr(10), ' ')}.{ext}"
    key = f"drive/{teacher.tenant_id}/{teacher.id}/voice-lab/{item_id}.{ext}"
    await asyncio.to_thread(drive.write_blob, key, data)
    db.add(File(id=file_id, tenant_id=teacher.tenant_id, owner_type=OwnerType.TEACHER, owner_teacher_id=teacher.id,
                scope=Scope.USER, storage_key=key, filename=name, mime_type=mime, size_bytes=len(data), checksum_sha256=hashlib.sha256(data).hexdigest()))
    await db.flush()
    folder = await drive.type_folder(db, teacher.id, teacher.tenant_id, drive.file_category(name, mime, service=service))
    db.add(DriveItem(id=drive_id, tenant_id=teacher.tenant_id, owner_teacher_id=teacher.id, parent_id=folder.id, kind="file", name=name,
                     file_id=file_id, source_type="upload", mime_type=mime, size_bytes=len(data)))
    item = VoiceLabItem(id=item_id, tenant_id=teacher.tenant_id, owner_id=teacher.id, title=title, kind=kind,
                        service=service, provider_id=provider_id, storage_key=key, mime_type=mime,
                        details={**details, "size_bytes": len(data), "drive_item_id": str(drive_id)})
    db.add(item)
    await db.flush()
    return item


async def read_upload(file: UploadFile | None, *, media=True) -> tuple[str, bytes, str]:
    if not file:
        raise HTTPException(422, "Carica un file audio")
    content = await file.read(MAX_BYTES + 1)
    if not content or len(content) > MAX_BYTES:
        raise HTTPException(413, "Il file deve contenere dati e pesare al massimo 50 MB")
    name = (file.filename or "audio.mp3")[:200]
    mime = file.content_type or "application/octet-stream"
    if media and not (mime.startswith(("audio/", "video/")) or name.lower().endswith((".mp3", ".wav", ".m4a", ".ogg", ".flac", ".webm", ".mp4", ".aac"))):
        raise HTTPException(422, "Carica un file audio o video supportato")
    return name, content, mime


async def budget(db, teacher, characters=0):
    estimate = billing.quote("tts", characters=characters, model=settings.ELEVENLABS_TTS_MODEL)["cost"]
    used = await drive.drive_usage_bytes(db, teacher.id)
    if used + 20 * 1024 * 1024 > settings.DRIVE_QUOTA_MB * 1024 * 1024:
        raise HTTPException(413, "Libera spazio nei Files prima di avviare una generazione")
    return estimate


@router.get("/config")
async def config(_: Teacher):
    return {"configured": bool(settings.ELEVENLABS_API_KEY), "default_model": settings.ELEVENLABS_TTS_MODEL,
            "max_upload_mb": MAX_BYTES // (1024 * 1024), "output_formats": list(eleven.OUTPUT_FORMATS), "pricing_rates": billing.RATES, "usd_to_eur": billing.USD_TO_EUR, "pricing_source": billing.SOURCE}


class QuoteRequest(BaseModel):
    action: Literal["tts", "dialogue", "convert", "transcribe", "isolate", "sound_effects", "music", "alignment", "dubbing", "voice_design"]
    characters: int = Field(default=0, ge=0, le=100000)
    seconds: float = Field(default=0, ge=0, le=10800)
    model: str = Field(default="", max_length=120)


@router.post("/quote")
async def generation_quote(body: QuoteRequest, _: Teacher):
    return billing.quote(**body.model_dump())


@router.get("/voices")
async def voices(db: Db, teacher: Teacher):
    return await visible_voices(db, teacher)


@router.get("/models")
async def models(_: Teacher):
    return await eleven.models()


@router.get("/items")
async def items(db: Db, teacher: Teacher):
    rows = (await db.execute(select(VoiceLabItem).where(VoiceLabItem.owner_id == teacher.id,
        VoiceLabItem.tenant_id == teacher.tenant_id).order_by(VoiceLabItem.created_at.desc()).limit(200))).scalars().all()
    return [serialize(item) for item in rows]


@router.get("/items/{item_id}")
async def item_details(item_id: UUID, db: Db, teacher: Teacher):
    return serialize(await owned(db, teacher, item_id), True)


@router.get("/items/{item_id}/content")
async def item_content(item_id: UUID, db: Db, teacher: Teacher, download: bool = False):
    item = await owned(db, teacher, item_id)
    if not item.storage_key:
        raise HTTPException(404, "File non ancora disponibile")
    try:
        data = await asyncio.to_thread(drive.read_blob, item.storage_key)
    except (FileNotFoundError, OSError) as exc:
        raise HTTPException(404, "Il file non è più disponibile nei Files") from exc
    ext = item.storage_key.rsplit(".", 1)[-1]
    name = quote(f"{item.title}.{ext}", safe="")
    return Response(data, media_type=item.mime_type, headers={"Cache-Control": "private, no-store",
                    "Content-Disposition": f"{'attachment' if download else 'inline'}; filename*=UTF-8''{name}"})


@router.post("/generate")
async def generate(db: Db, teacher: Teacher, payload: Annotated[str, Form(max_length=100000)], file: UploadFile | None = UploadField(None)):
    try:
        body = Generation.model_validate_json(payload)
    except ValidationError as exc:
        raise HTTPException(422, "; ".join(error["msg"] for error in exc.errors())) from exc
    character_count = len(body.text) if body.action == "tts" else sum(len(v.text) for v in body.dialogue) if body.action == "dialogue" else 0
    await budget(db, teacher, character_count)
    upload = await read_upload(file) if body.action in {"convert", "transcribe", "isolate", "alignment", "dubbing"} else None
    seconds = await billing.duration(upload[1]) if upload else body.seconds
    price = billing.quote(body.action, characters=character_count, seconds=seconds, model=body.model_id or settings.ELEVENLABS_TTS_MODEL)
    tx = None

    async def paid_request(*args, **kwargs):
        nonlocal tx
        tx = await billing.reserve(db, teacher, price, body.model_id or body.action)
        try:
            result = await eleven.request(*args, **kwargs)
        except eleven.UncertainGeneration as exc:
            raise eleven.UncertainGeneration(504, "Esito ElevenLabs da verificare: la quota resta prenotata. Controlla prima di riprovare.") from exc
        except Exception:
            await billing.settle(db, tx.id, status="refunded")
            raise
        if body.action != "dubbing":
            await billing.settle(db, tx.id, price)
        return result
    if body.voice_id or body.dialogue:
        await require_voices(db, teacher, {body.voice_id} if body.voice_id else {v.voice_id for v in body.dialogue})
    params = {"output_format": body.output_format}
    details = {"text": body.text, "language": body.language, "characters": character_count, "duration_seconds": seconds if upload or body.action in {"music", "sound_effects"} else None}
    response = None
    if body.action == "tts":
        model = body.model_id or settings.ELEVENLABS_TTS_MODEL
        catalogue = await eleven.models()
        selected = next((m for m in catalogue if m["model_id"] == model and m["tts"]), None)
        if not selected:
            raise HTTPException(422, "Scegli un modello di sintesi vocale disponibile")
        if len(body.text) > (selected.get("max_characters") or 5000):
            raise HTTPException(422, "Il testo supera il limite per richiesta di questo modello: dividilo in più parti")
        response = await paid_request("POST", f"/v1/text-to-speech/{eleven.identifier(body.voice_id)}", params=params,
            json={"text": body.text, "model_id": model, "language_code": body.language,
                  "voice_settings": {"stability": body.stability, "similarity_boost": body.similarity, "speed": body.speed}})
    elif body.action == "dialogue":
        response = await paid_request("POST", "/v1/text-to-dialogue", params=params,
            json={"inputs": [v.model_dump() for v in body.dialogue], "model_id": "eleven_v3", "language_code": body.language})
    elif body.action in {"sound_effects", "music"}:
        data = {"text": body.text, "duration_seconds": body.seconds, "model_id": "eleven_text_to_sound_v2"} if body.action == "sound_effects" else {
            "prompt": body.text, "music_length_ms": body.seconds * 1000, "force_instrumental": body.instrumental, "model_id": "music_v1"}
        response = await paid_request("POST", "/v1/sound-generation" if body.action == "sound_effects" else "/v1/music", json=data, params=params)
    else:
        if body.action == "dubbing":
            response = await paid_request("POST", "/v1/dubbing", files={"file": upload},
                data={"name": body.title, "source_lang": body.source_language, "target_lang": body.language, "watermark": "false"})
            item = VoiceLabItem(tenant_id=teacher.tenant_id, owner_id=teacher.id, title=body.title, kind="dubbing", service="dubbing",
                provider_id=response.json()["dubbing_id"], details={**details, **billing.details(tx, price), "status": "processing"})
            db.add(item)
            await db.commit()
            await db.refresh(item)
            return serialize(item, True)
        if body.action == "convert":
            model = body.model_id or "eleven_multilingual_sts_v2"
            catalogue = await eleven.models()
            if not any(m["model_id"] == model and m["conversion"] for m in catalogue):
                raise HTTPException(422, "Scegli un modello di cambio voce disponibile")
            response = await paid_request("POST", f"/v1/voice-changer/{eleven.identifier(body.voice_id)}", params=params,
                files={"audio": upload}, data={"model_id": model, "remove_background_noise": str(body.remove_noise).lower()})
        elif body.action == "isolate":
            response = await paid_request("POST", "/v1/audio-isolation", files={"audio": upload})
        else:
            data = {"model_id": body.model_id or "scribe_v2", "diarize": str(body.diarize).lower(), "language_code": body.language} if body.action == "transcribe" else {"text": body.text}
            response = await paid_request("POST", "/v1/speech-to-text" if body.action == "transcribe" else "/v1/forced-alignment", files={"file": upload}, data=data)
            result = response.json()
            item = await save_blob(db, teacher, body.title, body.action, json.dumps(result, ensure_ascii=False).encode(),
                "application/json", "json", {**details, **billing.details(tx, price), "transcript": result}, kind="transcript")
            await db.commit()
            await db.refresh(item)
            return serialize(item, True)
    audio = eleven.audio(response)
    mime, ext = eleven.OUTPUT_FORMATS[body.output_format] if body.action in {"tts", "dialogue", "convert", "music", "sound_effects"} else ("audio/mpeg", "mp3")
    actual_mime = response.headers.get("content-type", "").split(";")[0]
    known_mimes = {"audio/mpeg": "mp3", "audio/mp3": "mp3", "audio/wav": "wav", "audio/x-wav": "wav", "audio/ogg": "ogg", "audio/opus": "ogg", "audio/flac": "flac"}
    if actual_mime in known_mimes:
        mime, ext = actual_mime, known_mimes[actual_mime]
    try:
        details["provider_credit_units"] = float(response.headers.get("character-cost") or character_count)
    except (ValueError, OverflowError):
        details["characters"] = character_count
    item = await save_blob(db, teacher, body.title, body.action, audio, mime, ext, {**details, **billing.details(tx, price)})
    await db.commit()
    await db.refresh(item)
    return serialize(item, True)


@router.post("/voices/clone")
async def clone_voice(db: Db, teacher: Teacher, name: Annotated[str, Form(min_length=1, max_length=100)],
                      consent: Annotated[bool, Form()], description: Annotated[str, Form(max_length=1000)] = "",
                      remove_noise: Annotated[bool, Form()] = False, files: list[UploadFile] = UploadField(default=[])):
    if not consent:
        raise HTTPException(422, "Conferma di avere il diritto e il consenso a clonare questa voce")
    if not 1 <= len(files) <= 10:
        raise HTTPException(422, "Carica da 1 a 10 campioni audio")
    uploads = [await read_upload(file) for file in files]
    if sum(len(v[1]) for v in uploads) > MAX_BYTES:
        raise HTTPException(413, "I campioni possono pesare al massimo 50 MB in totale")
    await budget(db, teacher)
    result = (await eleven.request("POST", "/v1/voices/add", data={"name": name, "description": description,
        "remove_background_noise": str(remove_noise).lower()}, files=[("files", v) for v in uploads])).json()
    item = VoiceLabItem(tenant_id=teacher.tenant_id, owner_id=teacher.id, title=name, kind="voice", service="clone",
        provider_id=result["voice_id"], details={"description": description, "requires_verification": result.get("requires_verification", False), "consent_confirmed": True})
    db.add(item)
    await db.commit()
    await db.refresh(item)
    return serialize(item, True)


@router.post("/voices/design")
async def design_voice(body: VoiceDesign, db: Db, teacher: Teacher):
    await budget(db, teacher)
    if body.remix_voice_id:
        await require_voices(db, teacher, {body.remix_voice_id})
    path = f"/v1/text-to-voice/{eleven.identifier(body.remix_voice_id)}/remix" if body.remix_voice_id else "/v1/text-to-voice/design"
    price = billing.quote("voice_design", characters=3 * (len(body.text) or 1000))
    tx = await billing.reserve(db, teacher, price, "voice_design")
    try:
        result = (await eleven.request("POST", path, json={"voice_description": body.description, "text": body.text or None, "auto_generate_text": not bool(body.text)})).json()
    except eleven.UncertainGeneration as exc:
        raise eleven.UncertainGeneration(504, "Esito ElevenLabs da verificare: la quota resta prenotata. Controlla prima di riprovare.") from exc
    except Exception:
        await billing.settle(db, tx.id, status="refunded")
        raise
    price = billing.quote("voice_design", characters=len(result.get("text") or body.text or " " * 1000) * len(result.get("previews", [])))
    await billing.settle(db, tx.id, price)
    previews = []
    for index, preview in enumerate(result.get("previews", []), 1):
        try:
            data = base64.b64decode(preview["audio_base_64"], validate=True)
        except (ValueError, KeyError) as exc:
            raise HTTPException(502, "Anteprima vocale non valida") from exc
        item = await save_blob(db, teacher, f"Anteprima voce {index}", "voice_design", data, "audio/mpeg", "mp3",
            {**billing.details(tx, {**price, "credits": round(price["credits"] / max(1, len(result.get("previews", []))), 2)}), "description": body.description, "text": result.get("text", body.text)}, kind="preview", provider_id=preview["generated_voice_id"])
        previews.append(item)
    if not previews:
        raise HTTPException(502, "ElevenLabs non ha restituito anteprime")
    await db.commit()
    return [serialize(item, True) for item in previews]


@router.post("/voices/save")
async def save_voice(body: VoiceSave, db: Db, teacher: Teacher):
    preview = await owned(db, teacher, body.preview_id, lock=True)
    if preview.kind != "preview":
        raise HTTPException(422, "Scegli un'anteprima vocale")
    if preview.details.get("saved_voice_id"):
        return serialize(await owned(db, teacher, UUID(preview.details["saved_voice_id"])), True)
    result = (await eleven.request("POST", "/v1/text-to-voice", json={"voice_name": body.name,
        "voice_description": preview.details.get("description", ""), "generated_voice_id": preview.provider_id})).json()
    item = VoiceLabItem(id=uuid4(), tenant_id=teacher.tenant_id, owner_id=teacher.id, title=body.name, kind="voice", service="voice_design",
        provider_id=result["voice_id"], details={"description": preview.details.get("description", "")})
    db.add(item)
    preview.details = {**preview.details, "saved_voice_id": str(item.id)}
    await db.commit()
    await db.refresh(item)
    return serialize(item, True)


@router.delete("/voices/{item_id}")
async def delete_voice(item_id: UUID, db: Db, teacher: Teacher):
    item = await owned(db, teacher, item_id)
    if item.kind != "voice":
        raise HTTPException(422, "Questo elemento non è una voce salvata")
    await eleven.request("DELETE", f"/v1/voices/{eleven.identifier(item.provider_id)}")
    await db.delete(item)
    await db.commit()
    return {"ok": True}


@router.post("/items/{item_id}/refresh")
async def refresh_dubbing(item_id: UUID, db: Db, teacher: Teacher):
    item = await owned(db, teacher, item_id, lock=True)
    if item.kind != "dubbing":
        return serialize(item, True)
    job = (await eleven.request("GET", f"/v1/dubbing/{eleven.identifier(item.provider_id)}")).json()
    status = job.get("status")
    if status in {"dubbed", "completed"}:
        language = item.details["language"]
        if item.details.get("billing_transaction_id"):
            await billing.settle(db, item.details["billing_transaction_id"], item.details["pricing"], commit=False)
            item = await owned(db, teacher, item_id, lock=True)
        response = await eleven.request("GET", f"/v1/dubbing/{eleven.identifier(item.provider_id)}/audio/{language}")
        # Preserve the job record and link it to a private saved audio file.
        audio_item = await save_blob(db, teacher, item.title, "dubbing", eleven.audio(response), "audio/mpeg", "mp3", {"language": language})
        item.kind, item.storage_key, item.mime_type = "audio", audio_item.storage_key, audio_item.mime_type
        item.details = {**item.details, **audio_item.details, "status": "ready"}
        await db.delete(audio_item)
    elif status in {"failed", "error"}:
        if item.details.get("billing_transaction_id"):
            await billing.settle(db, item.details["billing_transaction_id"], status="refunded", commit=False)
        item.details = {**item.details, "status": "failed", "credits": 0}
    else:
        item.details = {**item.details, "status": "processing"}
    await db.commit()
    await db.refresh(item)
    return serialize(item, True)


from app.api.v1.endpoints.voice_playlists import router as playlists_router
router.include_router(playlists_router)
