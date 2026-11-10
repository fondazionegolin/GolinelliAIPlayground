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


async def _recording_for_teacher(db: AsyncSession, actor: StudentOrTeacher, recording_id: uuid.UUID) -> tuple[VoiceCallRecording, VoiceCall]:
    teacher = _teacher(actor)
    recording = await db.get(VoiceCallRecording, recording_id)
    if not recording:
        raise HTTPException(status_code=404, detail="Registrazione non trovata")
    call = await db.get(VoiceCall, recording.call_id)
    allowed = (
        (recording.session_id and await teacher_can_access_session(db, teacher, recording.session_id))
        or (call is not None and await vc.call_role(db, call, teacher=teacher) == "moderator")
    )
    if not allowed:
        raise HTTPException(status_code=403, detail="Registrazione non accessibile")
    return recording, call


async def _set_room_recording(call_id, value: Optional[dict]) -> None:
    try:
        from app.realtime.gateway import _broadcast_voice_state, voice_rooms
        key = vc.call_key(call_id)
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
    await _set_room_recording(call.id, {"id": str(recording.id), "started_at": started.isoformat()})
    return rec.serialize_recording(recording, call=call)


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
    await _moderated_call(db, actor, recording.call_id)
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
    if call:
        await _set_room_recording(call.id, None)
    await background_jobs.start_task_job(
        background_jobs.JobOwner.from_actor(actor), kind="call_recording", title=f"Trascrizione · {recording.title}",
        work=lambda ctx, rid=recording.id: rec.process_recording(rid, ctx),
        route=f"/teacher/sessions/{recording.session_id}?tab=calls" if recording.session_id else None,
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
        select(VoiceCall).where(VoiceCall.id.in_({r.call_id for r in recordings})))).scalars()} if recordings else {}
    analyses: dict = {}
    if recordings:
        for a in (await db.execute(select(VoiceCallAnalysis).where(
                VoiceCallAnalysis.recording_id.in_([r.id for r in recordings])).order_by(VoiceCallAnalysis.created_at))).scalars():
            analyses.setdefault(a.recording_id, []).append(a)
    return [rec.serialize_recording(r, call=calls.get(r.call_id), analyses=analyses.get(r.id, [])) for r in recordings]


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
    if analysis.knowledge_document_id:
        await rec.delete_knowledge_document(db, analysis.knowledge_document_id)
    await db.delete(analysis)
    await db.commit()


@router.delete("/recordings/{recording_id}", status_code=204)
async def delete_recording(
    recording_id: uuid.UUID,
    actor: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Delete audio, transcript, analyses and what they added to the session knowledge."""
    recording, call = await _recording_for_teacher(db, actor, recording_id)
    if recording.status == "recording" and call:
        await _set_room_recording(call.id, None)
    await rec.delete_recording(db, recording)
