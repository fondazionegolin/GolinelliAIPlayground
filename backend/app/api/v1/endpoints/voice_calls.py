"""Class video calls with invite links (`/call/<code>`): create, resolve, manage the link, LiveKit token.

Domain rules (audience, roles, codes) live in services/voice_calls.py. Calls are scheduled by linking them
to calendar events (endpoints/calendar.py, `voice_call_id` / `with_voice_call`).
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from typing import Annotated, Optional

import jwt
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import StudentOrTeacher, get_db, get_student_or_teacher
from app.api.v1.endpoints.voice import build_ice_servers
from app.core.config import settings
from app.core.permissions import teacher_can_access_class, teacher_can_access_session
from app.models.calendar import CalendarEvent, CalendarEventTarget
from app.models.session import Session
from app.models.user import User
from app.models.voice_call import VoiceCall
from app.services import voice_calls as vc

router = APIRouter(prefix="/voice-calls")


class VoiceCallIn(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    session_id: Optional[uuid.UUID] = None
    class_id: Optional[uuid.UUID] = None
    open_to_teachers: bool = False


class VoiceCallPatch(BaseModel):
    title: Optional[str] = Field(default=None, min_length=1, max_length=200)
    link_enabled: Optional[bool] = None
    open_to_teachers: Optional[bool] = None


def _teacher(actor: StudentOrTeacher) -> User:
    if not actor.is_teacher:
        raise HTTPException(status_code=403, detail="Solo i docenti possono gestire le videochiamate")
    return actor.teacher


async def _role(db: AsyncSession, call: VoiceCall, actor: StudentOrTeacher):
    if actor.is_teacher:
        return await vc.call_role(db, call, teacher=actor.teacher)
    return await vc.call_role(db, call, student_session_id=actor.student.session_id)


async def _owned(db: AsyncSession, teacher: User, call_id: uuid.UUID) -> VoiceCall:
    call = await db.get(VoiceCall, call_id)
    if not call:
        raise HTTPException(status_code=404, detail="Videochiamata non trovata")
    if call.owner_teacher_id != teacher.id:
        raise HTTPException(status_code=403, detail="Solo chi ha creato la videochiamata può modificarla")
    return call


async def _validate_audience(db: AsyncSession, teacher: User, session_id, class_id) -> tuple:
    if session_id:
        if not await teacher_can_access_session(db, teacher, session_id):
            raise HTTPException(status_code=403, detail="Sessione non accessibile")
        session = await db.get(Session, session_id)
        class_id = None if session and class_id == session.class_id else class_id
    if class_id and not await teacher_can_access_class(db, teacher, class_id):
        raise HTTPException(status_code=403, detail="Classe non accessibile")
    return session_id, class_id


async def create_call(
    db: AsyncSession, teacher: User, *, title: str, session_id=None, class_id=None, open_to_teachers: bool = False,
) -> VoiceCall:
    """Create a call (audience must already be validated). Shared with the calendar endpoints."""
    call = VoiceCall(
        tenant_id=teacher.tenant_id, owner_teacher_id=teacher.id, title=title.strip()[:200] or "Videochiamata",
        code=await vc.unique_code(db), session_id=session_id, class_id=class_id, open_to_teachers=open_to_teachers,
    )
    db.add(call)
    await db.flush()
    return call


@router.get("")
async def list_calls(
    actor: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
    db: Annotated[AsyncSession, Depends(get_db)],
    session_id: Optional[uuid.UUID] = None,
):
    """Calls of a session (sidebar; a student always gets their own session's) or, for a teacher without
    `session_id`, the calls they own or are invited to through a calendar event."""
    if actor.is_student:
        session_id = actor.student.session_id
    viewer_id = actor.teacher.id if actor.is_teacher else None
    if session_id:
        if actor.is_teacher and not await teacher_can_access_session(db, actor.teacher, session_id):
            raise HTTPException(status_code=403, detail="Sessione non accessibile")
        session = await db.get(Session, session_id)
        if not session:
            raise HTTPException(status_code=404, detail="Sessione non trovata")
        clause = vc.calls_for_session(session)
        if actor.is_student:
            clause = clause & VoiceCall.link_enabled.is_(True)
    else:
        teacher = _teacher(actor)
        invited = select(CalendarEvent.voice_call_id).join(
            CalendarEventTarget, CalendarEventTarget.event_id == CalendarEvent.id,
        ).where(CalendarEventTarget.target_type == "teacher", CalendarEventTarget.target_id == teacher.id)
        clause = or_(VoiceCall.owner_teacher_id == teacher.id, VoiceCall.id.in_(invited))
    calls = (await db.execute(
        select(VoiceCall).where(clause).order_by(VoiceCall.created_at.desc()).limit(60)
    )).scalars().all()
    out = []
    for call in calls:
        role = await _role(db, call, actor)
        if role:
            out.append(await vc.serialize_call(db, call, role=role, viewer_teacher_id=viewer_id))
    # Live first, then the closest scheduled occurrence, then the most recent.
    out.sort(key=lambda c: (not c["live"], c["next_event"]["starts_at"] if c["next_event"] else "9999", ))
    return out


@router.post("", status_code=201)
async def create_call_endpoint(
    body: VoiceCallIn,
    actor: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    teacher = _teacher(actor)
    session_id, class_id = await _validate_audience(db, teacher, body.session_id, body.class_id)
    call = await create_call(db, teacher, title=body.title, session_id=session_id, class_id=class_id,
                             open_to_teachers=body.open_to_teachers)
    await db.commit()
    await db.refresh(call)
    return await vc.serialize_call(db, call, role="moderator", viewer_teacher_id=teacher.id)


@router.get("/by-code/{code}")
async def resolve_call(
    code: str,
    actor: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    normalized = vc.normalize_code(code)
    call = (await db.execute(select(VoiceCall).where(VoiceCall.code == normalized))).scalar_one_or_none() if normalized else None
    if not call:
        raise HTTPException(status_code=404, detail="Codice videochiamata non valido o scaduto")
    role = await _role(db, call, actor)
    if not role:
        detail = "Il link di invito è stato disattivato" if not call.link_enabled else "Non fai parte degli invitati a questa videochiamata"
        raise HTTPException(status_code=403, detail=detail)
    return await vc.serialize_call(db, call, role=role, viewer_teacher_id=actor.teacher.id if actor.is_teacher else None)


@router.patch("/{call_id}")
async def update_call(
    call_id: uuid.UUID,
    body: VoiceCallPatch,
    actor: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    teacher = _teacher(actor)
    call = await _owned(db, teacher, call_id)
    for field, value in body.model_dump(exclude_unset=True).items():
        if value is not None:
            setattr(call, field, value.strip() if isinstance(value, str) else value)
    await db.commit()
    await db.refresh(call)
    if not call.link_enabled:
        await _kick_non_owners(call)
    return await vc.serialize_call(db, call, role="moderator", viewer_teacher_id=teacher.id)


@router.post("/{call_id}/regenerate-code")
async def regenerate_code(
    call_id: uuid.UUID,
    actor: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """New code: every invite link shared so far stops working (calendar events follow automatically)."""
    teacher = _teacher(actor)
    call = await _owned(db, teacher, call_id)
    call.code = await vc.unique_code(db)
    await db.commit()
    await db.refresh(call)
    return await vc.serialize_call(db, call, role="moderator", viewer_teacher_id=teacher.id)


@router.delete("/{call_id}", status_code=204)
async def delete_call(
    call_id: uuid.UUID,
    actor: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    teacher = _teacher(actor)
    call = await _owned(db, teacher, call_id)
    from app.services import call_recordings as _rec
    for orphan in (await db.execute(select(VoiceCallRecording).where(
            VoiceCallRecording.call_id == call.id, VoiceCallRecording.session_id.is_(None)))).scalars().all():
        await _rec.delete_recording(db, orphan)  # no session to keep it reachable from
    await _kick_non_owners(call, everyone=True)
    await db.delete(call)
    await db.commit()


async def _kick_non_owners(call: VoiceCall, everyone: bool = False) -> None:
    """Close the live room when the link is disabled or the call deleted (best effort)."""
    try:
        from app.realtime.gateway import end_voice_call
        await end_voice_call(str(call.id), reason="deleted" if everyone else "link_disabled")
    except Exception as exc:  # pragma: no cover - realtime is optional
        print(f"[voice-calls] could not close room {call.id}: {exc}")


@router.post("/{call_id}/token")
async def call_token(
    call_id: uuid.UUID,
    actor: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    if not settings.LIVEKIT_URL or not settings.LIVEKIT_API_KEY or not settings.LIVEKIT_API_SECRET:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Realtime media chat is not configured")
    call = await db.get(VoiceCall, call_id)
    if not call:
        raise HTTPException(status_code=404, detail="Videochiamata non trovata")
    role = await _role(db, call, actor)
    if not role:
        raise HTTPException(status_code=403, detail="Accesso alla videochiamata negato")

    now = datetime.now(timezone.utc)
    expires_at = now + timedelta(minutes=settings.LIVEKIT_TOKEN_TTL_MINUTES)
    if actor.is_student:
        from app.realtime.gateway import voice_rooms
        identity = f"student:{actor.student.id}"
        name = actor.student.nickname or "Studente"
        state = voice_rooms.get(vc.call_key(call.id)) or {}
        can_publish = str(actor.student.id) in (state.get("active_speaker_ids") or [])
    else:
        identity = f"teacher:{actor.teacher.id}"
        name = f"{actor.teacher.first_name or ''} {actor.teacher.last_name or ''}".strip() or "Docente"
        can_publish = True

    room = vc.livekit_room(call.id)
    token = jwt.encode({
        "iss": settings.LIVEKIT_API_KEY,
        "sub": identity,
        "name": name,
        "nbf": int(now.timestamp()),
        "exp": int(expires_at.timestamp()),
        "video": {"room": room, "roomJoin": True, "canSubscribe": True, "canPublish": can_publish, "canPublishData": True},
    }, settings.LIVEKIT_API_SECRET, algorithm="HS256")
    return {
        "url": settings.LIVEKIT_URL,
        "token": token,
        "room": room,
        "identity": identity,
        "can_publish": can_publish,
        "expires_at": expires_at.isoformat(),
        "ice_servers": build_ice_servers(),
    }


# ── Recordings ────────────────────────────────────────────────────────────────
# Started by a moderator, who captures every participant's audio track in the browser and uploads per-speaker
# segments; processed after `stop` (services/call_recordings.py). The session «Chiamate» tab lists them.

from fastapi import File as UploadField, Form, UploadFile  # noqa: E402

from app.models.voice_call import VoiceCallAnalysis, VoiceCallRecording, VoiceCallRecordingSegment  # noqa: E402
from app.services import call_recordings as rec  # noqa: E402


class RecordingStart(BaseModel):
    # The teacher confirms everyone in the call was told it is being recorded (minors: school policy applies).
    consent_confirmed: bool = False


class ToolRun(BaseModel):
    kind: str = Field(pattern="^(summary|synthesis|analysis|questions|custom)$")
    prompt: Optional[str] = Field(default=None, max_length=4000)
    # The session knowledge is visible to the session's students: the didactic analysis (participation,
    # difficulties) stays teacher-only unless the teacher adds it explicitly.
    add_to_knowledge: Optional[bool] = None


async def _moderated_call(db: AsyncSession, actor: StudentOrTeacher, call_id: uuid.UUID) -> VoiceCall:
    teacher = _teacher(actor)
    call = await db.get(VoiceCall, call_id)
    if not call:
        raise HTTPException(status_code=404, detail="Videochiamata non trovata")
    if await vc.call_role(db, call, teacher=teacher) != "moderator":
        raise HTTPException(status_code=403, detail="Solo i docenti della chiamata possono registrarla")
    return call


async def _recording_for_teacher(db: AsyncSession, actor: StudentOrTeacher, recording_id: uuid.UUID) -> tuple[VoiceCallRecording, Optional[VoiceCall]]:
    teacher = _teacher(actor)
    recording = await db.get(VoiceCallRecording, recording_id)
    if not recording:
        raise HTTPException(status_code=404, detail="Registrazione non trovata")
    call = await db.get(VoiceCall, recording.call_id) if recording.call_id else None
    allowed = (
        recording.started_by_teacher_id == teacher.id  # own recordings, including the personal ones (no call, no session)
        or (recording.session_id and await teacher_can_access_session(db, teacher, recording.session_id))
        or (call is not None and await vc.call_role(db, call, teacher=teacher) == "moderator")
    )
    if not allowed:
        raise HTTPException(status_code=403, detail="Registrazione non accessibile")
    return recording, call


def _room_key(recording: VoiceCallRecording) -> Optional[str]:
    """Voice room of a recording: the invite-link call's room, or the session's class voice room.
    None for a personal recording (microphone/system audio of the teacher, no room)."""
    if recording.call_id:
        return vc.call_key(recording.call_id)
    return str(recording.session_id) if recording.session_id else None


async def _set_room_recording(key: Optional[str], value: Optional[dict]) -> None:
    if not key:
        return
    try:
        from app.realtime.gateway import _broadcast_voice_state, voice_rooms
        state = voice_rooms.get(key)
        if state is not None:
            state["recording"] = value
            await _broadcast_voice_state(key)
    except Exception as exc:  # pragma: no cover - realtime is optional
        print(f"[voice-calls] recording flag broadcast failed: {exc}")


@router.post("/{call_id}/recordings", status_code=201)
async def start_recording(
    call_id: uuid.UUID,
    body: RecordingStart,
    actor: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    call = await _moderated_call(db, actor, call_id)
    if not body.consent_confirmed:
        raise HTTPException(status_code=400, detail="Conferma di aver informato i partecipanti della registrazione")
    running = (await db.execute(select(VoiceCallRecording).where(
        VoiceCallRecording.call_id == call.id, VoiceCallRecording.status == "recording"))).scalars().first()
    if running:
        return rec.serialize_recording(running, call=call)
    started = rec.now_utc()
    recording = VoiceCallRecording(
        tenant_id=call.tenant_id, call_id=call.id, session_id=call.session_id, started_by_teacher_id=actor.teacher.id,
        title=f"{call.title} · {started.astimezone().strftime('%d/%m %H:%M')}", status="recording", started_at=started,
    )
    db.add(recording)
    await db.commit()
    await db.refresh(recording)
    await _set_room_recording(_room_key(recording), {"id": str(recording.id), "started_at": started.isoformat()})
    return rec.serialize_recording(recording, call=call)


class SessionRecordingStart(RecordingStart):
    session_id: uuid.UUID


@router.post("/session-recordings", status_code=201)
async def start_session_recording(
    body: SessionRecordingStart,
    actor: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Record the class voice room of a session (a call started in the chat sidebar, without invite link)."""
    from app.realtime.gateway import voice_rooms
    teacher = _teacher(actor)
    if not await teacher_can_access_session(db, teacher, body.session_id):
        raise HTTPException(status_code=403, detail="Sessione non accessibile")
    if not body.consent_confirmed:
        raise HTTPException(status_code=400, detail="Conferma di aver informato i partecipanti della registrazione")
    if not (voice_rooms.get(str(body.session_id)) or {}).get("active"):
        raise HTTPException(status_code=409, detail="Avvia prima la chiamata")
    session = await db.get(Session, body.session_id)
    running = (await db.execute(select(VoiceCallRecording).where(
        VoiceCallRecording.call_id.is_(None), VoiceCallRecording.session_id == body.session_id,
        VoiceCallRecording.status == "recording"))).scalars().first()
    if running:
        return rec.serialize_recording(running)
    started = rec.now_utc()
    recording = VoiceCallRecording(
        tenant_id=session.tenant_id, call_id=None, session_id=body.session_id, started_by_teacher_id=teacher.id,
        title=f"Chiamata di classe · {started.astimezone().strftime('%d/%m %H:%M')}", status="recording", started_at=started,
    )
    db.add(recording)
    await db.commit()
    await db.refresh(recording)
    await _set_room_recording(_room_key(recording), {"id": str(recording.id), "started_at": started.isoformat()})
    return rec.serialize_recording(recording)


class PersonalStart(RecordingStart):
    # Automatic work once transcribed: translate summary + transcript, optionally read them aloud.
    languages: list[str] = Field(default_factory=list, max_length=4)
    speech: bool = False
    voice_id: Optional[str] = Field(default=None, max_length=120)
    provider: str = Field(default="auto", pattern="^(auto|elevenlabs|openrouter)$")
    fallback_model: Optional[str] = Field(default=None, max_length=120)


@router.post("/personal-recordings", status_code=201)
async def start_personal_recording(
    body: PersonalStart,
    actor: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Record from the teacher's own device (microphone, optionally system audio), outside any call or session.
    Same pipeline afterwards: transcription, summary and AI tools. Nothing goes to a session's knowledge."""
    teacher = _teacher(actor)
    if not body.consent_confirmed:
        raise HTTPException(status_code=400, detail="Conferma di aver informato le persone registrate")
    from app.services import call_languages
    languages = [c for c in dict.fromkeys(body.languages) if c in call_languages.BY_CODE]
    if body.voice_id:
        from app.api.v1.endpoints.voice_lab import require_voices
        await require_voices(db, teacher, {body.voice_id})
    pipeline = ({"languages": languages, "speech": body.speech, "voice_id": body.voice_id, "provider": body.provider,
                 "fallback_model": body.fallback_model} if languages else None)
    started = rec.now_utc()
    recording = VoiceCallRecording(
        tenant_id=teacher.tenant_id, call_id=None, session_id=None, started_by_teacher_id=teacher.id,
        title=f"Registrazione · {started.astimezone().strftime('%d/%m %H:%M')}", status="recording", started_at=started,
        pipeline=pipeline,
    )
    db.add(recording)
    await db.commit()
    await db.refresh(recording)
    return rec.serialize_recording(recording)


@router.get("/my-recordings")
async def list_my_recordings(
    actor: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """The teacher's personal recordings (made outside calls)."""
    teacher = _teacher(actor)
    recordings = (await db.execute(
        select(VoiceCallRecording).where(
            VoiceCallRecording.started_by_teacher_id == teacher.id,
            VoiceCallRecording.call_id.is_(None), VoiceCallRecording.session_id.is_(None))
        .order_by(VoiceCallRecording.started_at.desc()).limit(200)
    )).scalars().all()
    return [rec.serialize_recording(r) for r in recordings]


@router.post("/recordings/{recording_id}/segments", status_code=201)
async def upload_segment(
    recording_id: uuid.UUID,
    actor: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
    db: Annotated[AsyncSession, Depends(get_db)],
    file: UploadFile = UploadField(...),
    identity: str = Form(..., max_length=200),
    name: str = Form("", max_length=200),
    offset_ms: int = Form(..., ge=0),
    duration_ms: int = Form(..., ge=0),
):
    recording = await db.get(VoiceCallRecording, recording_id)
    if not recording:
        raise HTTPException(status_code=404, detail="Registrazione non trovata")
    if recording.call_id:
        await _moderated_call(db, actor, recording.call_id)
    elif recording.session_id:
        if not await teacher_can_access_session(db, _teacher(actor), recording.session_id):
            raise HTTPException(status_code=403, detail="Registrazione non accessibile")
    elif recording.started_by_teacher_id != _teacher(actor).id:  # personal recording: only its owner
        raise HTTPException(status_code=403, detail="Registrazione non accessibile")
    if recording.status not in ("recording", "processing"):
        raise HTTPException(status_code=409, detail="La registrazione è già stata elaborata")
    data = await file.read()
    if not data:
        return {"skipped": True}
    if len(data) > rec.MAX_SEGMENT_BYTES:
        raise HTTPException(status_code=413, detail="Segmento audio troppo grande")
    extension = "ogg" if "ogg" in (file.content_type or "") else "webm"
    segment = await rec.save_segment(db, recording, data, identity=identity, name=name, offset_ms=offset_ms,
                                     duration_ms=duration_ms, extension=extension)
    return {"id": str(segment.id)}


@router.post("/recordings/{recording_id}/stop")
async def stop_recording(
    recording_id: uuid.UUID,
    actor: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """End the capture and start transcription + analysis in the background (also used to retry a failed one)."""
    from app.services import background_jobs
    recording, call = await _recording_for_teacher(db, actor, recording_id)
    if recording.status == "processing":
        return rec.serialize_recording(recording, call=call)
    if recording.status == "recording":
        recording.ended_at = rec.now_utc()
        recording.duration_seconds = int((recording.ended_at - recording.started_at).total_seconds())
    recording.status = "processing"
    recording.error_message = None
    await db.commit()
    await _set_room_recording(_room_key(recording), None)
    await background_jobs.start_task_job(
        background_jobs.JobOwner.from_actor(actor), kind="call_recording", title=f"Trascrizione · {recording.title}",
        work=lambda ctx, rid=recording.id: rec.process_recording(rid, ctx),
        route=(f"/teacher/sessions/{recording.session_id}?tab=calls" if recording.session_id
               else f"/teacher/recordings?recording={recording.id}" if not recording.call_id else None),
        resource_id=str(recording.id), expected_seconds=max(30, (recording.duration_seconds or 60) // 4),
    )
    return rec.serialize_recording(recording, call=call)


@router.get("/recordings")
async def list_recordings(
    actor: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
    db: Annotated[AsyncSession, Depends(get_db)],
    session_id: uuid.UUID,
):
    teacher = _teacher(actor)
    if not await teacher_can_access_session(db, teacher, session_id):
        raise HTTPException(status_code=403, detail="Sessione non accessibile")
    recordings = (await db.execute(
        select(VoiceCallRecording).where(VoiceCallRecording.session_id == session_id)
        .order_by(VoiceCallRecording.started_at.desc()).limit(100)
    )).scalars().all()
    calls = {c.id: c for c in (await db.execute(
        select(VoiceCall).where(VoiceCall.id.in_({r.call_id for r in recordings if r.call_id})))).scalars()} if recordings else {}
    analyses: dict = {}
    if recordings:
        for a in (await db.execute(select(VoiceCallAnalysis).where(
                VoiceCallAnalysis.recording_id.in_([r.id for r in recordings])).order_by(VoiceCallAnalysis.created_at))).scalars():
            analyses.setdefault(a.recording_id, []).append(a)
    return [rec.serialize_recording(r, call=calls.get(r.call_id) if r.call_id else None, analyses=analyses.get(r.id, [])) for r in recordings]


@router.get("/recordings/{recording_id}")
async def get_recording(
    recording_id: uuid.UUID,
    actor: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    recording, call = await _recording_for_teacher(db, actor, recording_id)
    analyses = (await db.execute(select(VoiceCallAnalysis).where(VoiceCallAnalysis.recording_id == recording.id)
                                 .order_by(VoiceCallAnalysis.created_at))).scalars().all()
    return rec.serialize_recording(recording, call=call, analyses=list(analyses), full=True)


@router.post("/recordings/{recording_id}/tools")
async def run_recording_tool(
    recording_id: uuid.UUID,
    body: ToolRun,
    actor: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    from app.services.credit_service import credit_service
    recording, _call = await _recording_for_teacher(db, actor, recording_id)
    if recording.status != "ready":
        raise HTTPException(status_code=409, detail="La trascrizione non è ancora pronta")
    teacher = actor.teacher
    if teacher.tenant_id and not await credit_service.check_availability(db, teacher.tenant_id, teacher_id=teacher.id):
        raise HTTPException(status_code=402, detail="Crediti esauriti")
    try:
        add = body.add_to_knowledge if body.add_to_knowledge is not None else body.kind != "analysis"
        analysis = await rec.run_tool(db, recording, teacher, body.kind, body.prompt, add)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return {"id": str(analysis.id), "kind": analysis.kind, "title": analysis.title, "prompt": analysis.prompt,
            "content": analysis.content, "in_knowledge": bool(analysis.knowledge_document_id),
            "created_at": analysis.created_at.isoformat() if analysis.created_at else None}


@router.post("/recordings/analyses/{analysis_id}/knowledge")
async def add_analysis_to_knowledge(
    analysis_id: uuid.UUID,
    actor: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    analysis = await db.get(VoiceCallAnalysis, analysis_id)
    if not analysis:
        raise HTTPException(status_code=404, detail="Analisi non trovata")
    recording, _call = await _recording_for_teacher(db, actor, analysis.recording_id)
    if not recording.session_id:
        raise HTTPException(status_code=409, detail="La chiamata non è collegata a una sessione")
    if not analysis.knowledge_document_id:
        analysis.knowledge_document_id = await rec.add_to_knowledge(
            db, recording, f"{analysis.title} · {recording.title}", analysis.content, f"call_{analysis.kind}")
        await db.commit()
    return {"in_knowledge": True}


class ShareBody(BaseModel):
    session_id: Optional[uuid.UUID] = None
    student_id: Optional[uuid.UUID] = None  # a single student (private message); otherwise the whole class chat
    include_audio: bool = False


@router.post("/recordings/analyses/{analysis_id}/share")
async def share_analysis(
    analysis_id: uuid.UUID,
    actor: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
    db: Annotated[AsyncSession, Depends(get_db)],
    body: Optional[ShareBody] = None,
):
    """Publish a result in the class chat of a session (or privately to one student), where students read it."""
    body = body or ShareBody()
    analysis = await db.get(VoiceCallAnalysis, analysis_id)
    if not analysis:
        raise HTTPException(status_code=404, detail="Risultato non trovato")
    recording, _call = await _recording_for_teacher(db, actor, analysis.recording_id)
    target_session = body.session_id or recording.session_id
    if target_session and not await teacher_can_access_session(db, actor.teacher, target_session):
        raise HTTPException(status_code=403, detail="Sessione non accessibile")
    try:
        await rec.share_to_session(db, recording, analysis, actor.teacher, session_id=target_session,
                                   student_id=body.student_id, include_audio=body.include_audio)
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return {"shared": True}


@router.delete("/recordings/analyses/{analysis_id}", status_code=204)
async def delete_analysis(
    analysis_id: uuid.UUID,
    actor: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    analysis = await db.get(VoiceCallAnalysis, analysis_id)
    if not analysis:
        raise HTTPException(status_code=404, detail="Analisi non trovata")
    await _recording_for_teacher(db, actor, analysis.recording_id)
    from app.services import call_translation
    await call_translation.delete_translation(db, analysis)  # also removes the spoken file and the knowledge copy
    await db.commit()


@router.delete("/recordings/{recording_id}", status_code=204)
async def delete_recording(
    recording_id: uuid.UUID,
    actor: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Delete audio, transcript, analyses and what they added to the session knowledge."""
    recording, call = await _recording_for_teacher(db, actor, recording_id)
    if recording.status == "recording":
        await _set_room_recording(_room_key(recording), None)
    await rec.delete_recording(db, recording)


# ── Transcription engine (admin setting) ──────────────────────────────────────

class TranscriptionSetting(BaseModel):
    engine: str = Field(pattern="^(local|openai)$")
    model: str = Field(min_length=1, max_length=60)
    preload: bool = False


def _is_admin(user: User) -> bool:
    from app.models.enums import UserRole
    return user.role == UserRole.ADMIN


@router.get("/transcription-settings")
async def get_transcription_settings(
    actor: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    from app.services import local_stt
    teacher = _teacher(actor)
    return {
        "current": await local_stt.get_setting(db),
        "options": [{k: v for k, v in m.items() if k != "repo"} for m in local_stt.MODELS],
        "can_edit": _is_admin(teacher),
        **local_stt.status(),
    }


@router.put("/transcription-settings")
async def update_transcription_settings(
    body: TranscriptionSetting,
    actor: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Admin: choose the speech-to-text model for call recordings; `preload` downloads/loads it now."""
    import asyncio
    from app.services import local_stt
    teacher = _teacher(actor)
    if not _is_admin(teacher):
        raise HTTPException(status_code=403, detail="Solo gli amministratori scelgono il modello di trascrizione")
    try:
        current = await local_stt.set_setting(db, body.engine, body.model)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    if body.preload and body.engine == "local":
        asyncio.get_running_loop().create_task(local_stt.preload(body.model))  # download in background
    return {"current": current, **local_stt.status()}


# ── Translation and speech ────────────────────────────────────────────────────

@router.get("/languages")
async def translation_languages(actor: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)]):
    """Languages for translating recordings, and the speech services available (ElevenLabs + OpenRouter fallbacks)."""
    from app.services import call_languages, call_tts
    _teacher(actor)
    return {
        "source": call_languages.SOURCE, "languages": call_languages.LANGUAGES,
        "speech": {"elevenlabs": bool(settings.ELEVENLABS_API_KEY), "fallbacks": await call_tts.fallback_options(),
                   "default_fallback": call_tts.DEFAULT_FALLBACK},
    }


class TranslateBody(BaseModel):
    language: str = Field(min_length=2, max_length=8)
    source: str = Field(pattern="^(summary|transcript)$")


@router.post("/recordings/{recording_id}/translate", status_code=202)
async def translate_recording_endpoint(
    recording_id: uuid.UUID,
    body: TranslateBody,
    actor: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Translate the summary or the full transcript. Runs as a background job: it survives page changes."""
    from app.core.database import AsyncSessionLocal
    from app.services import background_jobs, call_languages, call_translation
    from app.services.credit_service import credit_service
    recording, _call = await _recording_for_teacher(db, actor, recording_id)
    if recording.status != "ready":
        raise HTTPException(status_code=409, detail="La trascrizione non è ancora pronta")
    if body.language not in call_languages.BY_CODE:
        raise HTTPException(status_code=422, detail="Lingua non disponibile")
    teacher = actor.teacher
    if teacher.tenant_id and not await credit_service.check_availability(db, teacher.tenant_id, teacher_id=teacher.id):
        raise HTTPException(status_code=402, detail="Crediti esauriti")
    teacher_id, rid = teacher.id, recording.id
    label = f"{call_translation.SOURCE_LABEL[body.source]} in {call_languages.language_name(body.language)}"

    async def work(ctx):
        async with AsyncSessionLocal() as session:
            fresh_teacher, fresh = await session.get(User, teacher_id), await session.get(VoiceCallRecording, rid)
            await ctx.progress(0.1, f"Traduzione · {label}", force=True)
            analysis = await call_translation.translate_recording(session, fresh, fresh_teacher, body.language, body.source)
            return {"analysis_id": str(analysis.id)}

    await background_jobs.start_task_job(
        background_jobs.JobOwner.from_actor(actor), kind="call_translation", title=f"Traduzione · {label}", work=work,
        route=_recording_route(recording), resource_id=str(recording.id), expected_seconds=40,
    )
    return {"started": True}


def _recording_route(recording: VoiceCallRecording) -> Optional[str]:
    if recording.session_id:
        return f"/teacher/sessions/{recording.session_id}?tab=calls&recording={recording.id}"
    return f"/teacher/recordings?recording={recording.id}" if not recording.call_id else None


class SpeechBody(BaseModel):
    voice_id: Optional[str] = Field(default=None, max_length=120)
    provider: str = Field(default="auto", pattern="^(auto|elevenlabs|openrouter)$")
    fallback_model: Optional[str] = Field(default=None, max_length=120)


@router.post("/recordings/analyses/{analysis_id}/speech", status_code=202)
async def speak_analysis_endpoint(
    analysis_id: uuid.UUID,
    body: SpeechBody,
    actor: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Read a translation (or the summary) aloud. ElevenLabs first, an OpenRouter speech model as fallback."""
    from app.core.database import AsyncSessionLocal
    from app.services import background_jobs, call_translation
    analysis = await db.get(VoiceCallAnalysis, analysis_id)
    if not analysis:
        raise HTTPException(status_code=404, detail="Risultato non trovato")
    recording, _call = await _recording_for_teacher(db, actor, analysis.recording_id)
    if analysis.kind not in ("translation", "summary", "synthesis"):
        raise HTTPException(status_code=422, detail="Solo traduzioni, riassunti e sintesi si possono leggere ad alta voce")
    if body.voice_id:
        from app.api.v1.endpoints.voice_lab import require_voices
        await require_voices(db, actor.teacher, {body.voice_id})
    teacher_id, rid, aid, title = actor.teacher.id, recording.id, analysis.id, analysis.title

    async def work(ctx):
        async with AsyncSessionLocal() as session:
            fresh_teacher, fresh = await session.get(User, teacher_id), await session.get(VoiceCallRecording, rid)
            fresh_analysis = await session.get(VoiceCallAnalysis, aid)
            await call_translation.speak_analysis(session, fresh, fresh_teacher, fresh_analysis, voice_id=body.voice_id,
                                                  provider=body.provider, fallback_model=body.fallback_model,
                                                  progress=lambda f, label: ctx.progress(f, label, force=True))
            return {"analysis_id": str(aid), "provider": fresh_analysis.audio_provider}

    await background_jobs.start_task_job(
        background_jobs.JobOwner.from_actor(actor), kind="call_speech", title=f"Voce · {title}", work=work,
        route=_recording_route(recording), resource_id=str(recording.id),
        expected_seconds=max(20, len(analysis.content) / 120),
    )
    return {"started": True}


@router.get("/recordings/analyses/{analysis_id}/audio")
async def analysis_audio(
    analysis_id: uuid.UUID,
    actor: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
    db: Annotated[AsyncSession, Depends(get_db)],
    download: bool = False,
):
    from pathlib import Path
    from fastapi.responses import FileResponse
    analysis = await db.get(VoiceCallAnalysis, analysis_id)
    if not analysis or not analysis.audio_key:
        raise HTTPException(status_code=404, detail="Audio non disponibile")
    await _recording_for_teacher(db, actor, analysis.recording_id)
    path = Path("uploads") / analysis.audio_key
    if not path.exists():
        raise HTTPException(status_code=404, detail="Audio non disponibile")
    name = f"{analysis.title}.mp3".replace("/", "-")
    return FileResponse(path, media_type="audio/mpeg", filename=name if download else None)


@router.get("/share-targets")
async def share_targets(
    actor: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Sessions the teacher can share a result with."""
    from app.api.v1.endpoints.smart_canvas import teacher_sessions
    return [{"id": str(s.id), "title": s.title, "class_name": class_name}
            for s, class_name in await teacher_sessions(db, _teacher(actor))]


@router.get("/share-targets/{session_id}/students")
async def share_target_students(
    session_id: uuid.UUID,
    actor: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    from app.models.session import SessionStudent
    if not await teacher_can_access_session(db, _teacher(actor), session_id):
        raise HTTPException(status_code=403, detail="Sessione non accessibile")
    rows = (await db.execute(select(SessionStudent).where(SessionStudent.session_id == session_id)
                             .order_by(SessionStudent.nickname))).scalars().all()
    return [{"id": str(r.id), "nickname": r.nickname} for r in rows]
