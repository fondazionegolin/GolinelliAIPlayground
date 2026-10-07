from sqlalchemy import Boolean, Column, DateTime, ForeignKey, String, Text, false as sa_false, func
from sqlalchemy.dialects.postgresql import UUID
import uuid

from app.core.database import Base


class TeacherMemoryItem(Base):
    """One thing the teacher's chatbot knows about its teacher (preference, subject, ongoing project…).

    Items are learned from the teacher's chats or written by the teacher, are always visible and deletable by the teacher,
    and are injected into every teacher chat so the assistant stays aligned across conversations."""
    __tablename__ = "teacher_memory_items"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False, index=True)
    teacher_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    kind = Column(String(20), nullable=False, default="fact")  # preference | style | subject | project | fact
    text = Column(Text, nullable=False)
    source = Column(String(10), nullable=False, default="chat")  # chat | manual
    pinned = Column(Boolean, nullable=False, default=False, server_default=sa_false())
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)


class TeacherMemoryPrefs(Base):
    __tablename__ = "teacher_memory_prefs"

    teacher_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    enabled = Column(Boolean, nullable=False, default=True, server_default="true")
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)
