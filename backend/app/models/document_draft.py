from sqlalchemy import Column, String, DateTime, ForeignKey, Text, func
from sqlalchemy.dialects.postgresql import UUID
import uuid

from app.core.database import Base


class DocumentDraft(Base):
    __tablename__ = "document_drafts"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False, index=True)
    session_id = Column(UUID(as_uuid=True), ForeignKey("sessions.id"), nullable=True, index=True)
    owner_teacher_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True, index=True)
    owner_student_id = Column(UUID(as_uuid=True), ForeignKey("session_students.id"), nullable=True, index=True)
    title = Column(String, nullable=False)
    doc_type = Column(String, nullable=False)  # document | presentation
    content_json = Column(Text, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)
