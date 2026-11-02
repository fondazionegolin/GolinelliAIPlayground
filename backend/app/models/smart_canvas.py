import uuid

from sqlalchemy import Column, DateTime, ForeignKey, Index, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB, UUID

from app.core.database import Base


class SmartCanvas(Base):
    """A Figma-like board the AI can read (pixels + structure + recent edits) and draw on; private, or shared with a session."""
    __tablename__ = "smart_canvases"
    __table_args__ = (Index("ix_smart_canvases_owner_updated", "owner_id", "updated_at"),)

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    # Exactly one owner: a teacher (owner_id) or a student of a session (owner_student_id).
    owner_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=True)
    owner_student_id = Column(UUID(as_uuid=True), ForeignKey("session_students.id", ondelete="CASCADE"), nullable=True, index=True)
    # Shared boards live in `session_canvas` (real-time sync, cursors, the students-can-write flag) under `canvas_key`.
    session_id = Column(UUID(as_uuid=True), ForeignKey("sessions.id", ondelete="SET NULL"), nullable=True, index=True)
    canvas_key = Column(String(240), nullable=True)
    title = Column(String(200), nullable=False)
    content_json = Column(Text, nullable=False, default='{"type":"canvas_v1","items":[]}')
    messages = Column(JSONB, nullable=False, default=list)
    preview = Column(Text, nullable=True)  # small JPEG data URL, drawn by the browser from the board
    version = Column(Integer, nullable=False, default=1)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())
