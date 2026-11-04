import uuid
from sqlalchemy import Column, DateTime, ForeignKey, Index, String, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from app.core.database import Base


class VoiceLabItem(Base):
    __tablename__ = "voice_lab_items"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False)
    owner_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    title = Column(String(200), nullable=False)
    kind = Column(String(24), nullable=False)  # audio | transcript | preview | voice | dubbing
    service = Column(String(32), nullable=False)
    provider_id = Column(String(120), nullable=True, index=True)
    storage_key = Column(String(400), nullable=True)
    mime_type = Column(String(120), nullable=True)
    details = Column(JSONB, nullable=False, default=dict)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    __table_args__ = (Index("ix_voice_lab_owner_created", "owner_id", "created_at"),)


class VoiceLabPlaylist(Base):
    __tablename__ = "voice_lab_playlists"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False)
    owner_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    owner_student_id = Column(UUID(as_uuid=True), ForeignKey("session_students.id", ondelete="CASCADE"), nullable=True, index=True)
    title = Column(String(200), nullable=False)
    folder_id = Column(UUID(as_uuid=True), ForeignKey("drive_items.id", ondelete="CASCADE"), nullable=False, unique=True)
    track_ids = Column(JSONB, nullable=False, default=list)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())


class ClassAudioPlayback(Base):
    __tablename__ = "class_audio_playback"
    class_id = Column(UUID(as_uuid=True), ForeignKey("classes.id", ondelete="CASCADE"), primary_key=True)
    teacher_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    playlist_id = Column(UUID(as_uuid=True), ForeignKey("voice_lab_playlists.id", ondelete="SET NULL"), nullable=True)
    state = Column(JSONB, nullable=False, default=dict)
