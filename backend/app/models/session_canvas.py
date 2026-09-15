from sqlalchemy import Column, String, DateTime, ForeignKey, Text, Integer, Boolean, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import UUID
import uuid

from app.core.database import Base


class SessionCanvas(Base):
    __tablename__ = "session_canvas"
    __table_args__ = (UniqueConstraint("session_id", "canvas_key", name="uq_session_canvas_session_key"),)

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False, index=True)
    session_id = Column(UUID(as_uuid=True), ForeignKey("sessions.id"), nullable=False, index=True)
    canvas_key = Column(String(240), nullable=False, default="lavagna collaborativa", index=True)
    title = Column(String, nullable=False, default="Lavagna collaborativa")
    content_json = Column(Text, nullable=False, default='{"type":"canvas_v1","items":[]}')
    version = Column(Integer, nullable=False, default=1)
    students_can_write = Column(Boolean, nullable=False, default=False)
    updated_by_teacher_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True, index=True)
    updated_by_student_id = Column(UUID(as_uuid=True), ForeignKey("session_students.id"), nullable=True, index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)


def normalize_canvas_key(value: str | None) -> str:
    """Stable, case-insensitive document identity used by collaborative boards."""
    normalized = " ".join((value or "Lavagna collaborativa").strip().casefold().split())
    return (normalized or "lavagna collaborativa")[:240]
