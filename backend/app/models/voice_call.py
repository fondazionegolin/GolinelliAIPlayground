from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID
import uuid

from app.core.database import Base


class VoiceCall(Base):
    """A class video call reachable through an invite link `/call/<code>`.

    The audience is the bound session/class plus everyone invited to the calendar events that link it
    (`calendar_events.voice_call_id`). With `open_to_teachers`, any signed-in teacher holding the link may
    join too; students always need to belong to the audience. Disabling the link (or regenerating the code)
    invalidates every copy already shared. The live room state is in-memory in the gateway (key `call:<id>`).
    """
    __tablename__ = "voice_calls"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    owner_teacher_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    title = Column(String(200), nullable=False)
    # Short human-friendly id, e.g. "kqf-mxta-vbe": the invite link and the code typed in "Partecipa".
    code = Column(String(16), nullable=False, unique=True, index=True)
    session_id = Column(UUID(as_uuid=True), ForeignKey("sessions.id", ondelete="SET NULL"), nullable=True, index=True)
    class_id = Column(UUID(as_uuid=True), ForeignKey("classes.id", ondelete="SET NULL"), nullable=True, index=True)
    link_enabled = Column(Boolean, nullable=False, default=True)
    open_to_teachers = Column(Boolean, nullable=False, default=False)
    last_started_at = Column(DateTime(timezone=True), nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)


class VoiceCallRecording(Base):
    """One recorded stretch of a call. Audio arrives as per-speaker segments recorded in the moderator's browser
    (one LiveKit track each, so the speaker is known exactly); after `stop` the server transcribes and merges
    them, then the AI tools (summary, synthesis, analysis) work on the transcript. Text ends up in the session
    knowledge (RAG documents, scope SESSION) when the call is bound to a session."""
    __tablename__ = "voice_call_recordings"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    call_id = Column(UUID(as_uuid=True), ForeignKey("voice_calls.id", ondelete="CASCADE"), nullable=False, index=True)
    session_id = Column(UUID(as_uuid=True), ForeignKey("sessions.id", ondelete="SET NULL"), nullable=True, index=True)
    started_by_teacher_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    title = Column(String(200), nullable=False)
    status = Column(String(16), nullable=False, default="recording")  # recording | processing | ready | failed
    started_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    ended_at = Column(DateTime(timezone=True), nullable=True)
    duration_seconds = Column(Integer, nullable=True)
    transcript = Column(JSONB, nullable=True)       # [{speaker, identity, start, end, text}]
    participants = Column(JSONB, nullable=True)     # [{name, identity, role, seconds, turns, words}]
    knowledge_document_id = Column(UUID(as_uuid=True), nullable=True)
    error_message = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class VoiceCallRecordingSegment(Base):
    """A few minutes of one participant's audio; offset_ms is measured from the recording start."""
    __tablename__ = "voice_call_recording_segments"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    recording_id = Column(UUID(as_uuid=True), ForeignKey("voice_call_recordings.id", ondelete="CASCADE"), nullable=False, index=True)
    identity = Column(String(200), nullable=False)
    speaker_name = Column(String(200), nullable=False)
    offset_ms = Column(Integer, nullable=False)
    duration_ms = Column(Integer, nullable=False)
    storage_key = Column(String(500), nullable=False)
    transcript = Column(JSONB, nullable=True)       # whisper segments relative to this file
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class VoiceCallAnalysis(Base):
    """Output of an AI tool run on a recording transcript (summary, synthesis, analysis, free question)."""
    __tablename__ = "voice_call_analyses"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    recording_id = Column(UUID(as_uuid=True), ForeignKey("voice_call_recordings.id", ondelete="CASCADE"), nullable=False, index=True)
    kind = Column(String(32), nullable=False)
    title = Column(String(200), nullable=False)
    prompt = Column(Text, nullable=True)
    content = Column(Text, nullable=False)
    created_by_teacher_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    knowledge_document_id = Column(UUID(as_uuid=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
