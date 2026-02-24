from sqlalchemy import Column, String, DateTime, ForeignKey, Text, Float, func
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import relationship
import uuid

from app.core.database import Base


class ContentAlert(Base):
    __tablename__ = "content_alerts"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False, index=True)
    session_id = Column(UUID(as_uuid=True), ForeignKey("sessions.id"), nullable=False, index=True)
    student_id = Column(UUID(as_uuid=True), ForeignKey("session_students.id"), nullable=False, index=True)
    conversation_id = Column(UUID(as_uuid=True), nullable=True)
    alert_type = Column(String(50), nullable=False)
    status = Column(String(50), nullable=False, default="pending")
    original_message = Column(Text, nullable=False)
    masked_message = Column(Text, nullable=True)
    risk_score = Column(Float, nullable=True)
    details = Column(JSONB, default=dict, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    resolved_at = Column(DateTime(timezone=True), nullable=True)

    # Relationships
    student = relationship("SessionStudent", foreign_keys=[student_id])
