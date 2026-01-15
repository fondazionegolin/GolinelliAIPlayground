from sqlalchemy import Column, String, Enum, DateTime, ForeignKey, Text, func, Index
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import relationship
import uuid

from app.core.database import Base
from app.models.enums import MessageRole


class LLMProfile(Base):
    __tablename__ = "llm_profiles"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=True, index=True)
    key = Column(String, unique=True, nullable=False, index=True)
    ui_schema_json = Column(JSONB, default=dict, nullable=False)
    system_prompt_template = Column(Text, nullable=False)
    allowed_tools_json = Column(JSONB, default=list, nullable=False)
    default_model_pref = Column(JSONB, default=dict, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class Conversation(Base):
    __tablename__ = "conversations"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False, index=True)
    session_id = Column(UUID(as_uuid=True), ForeignKey("sessions.id"), nullable=False, index=True)
    student_id = Column(UUID(as_uuid=True), ForeignKey("session_students.id"), nullable=False, index=True)
    profile_key = Column(String, nullable=False)
    title = Column(String, nullable=True)
    llm_provider = Column(String, nullable=True)
    llm_model = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    # Relationships
    session = relationship("Session", back_populates="conversations")
    student = relationship("SessionStudent", back_populates="conversations")
    messages = relationship("ConversationMessage", back_populates="conversation", lazy="dynamic", cascade="all, delete-orphan")


class ConversationMessage(Base):
    __tablename__ = "conversation_messages"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False)
    conversation_id = Column(UUID(as_uuid=True), ForeignKey("conversations.id"), nullable=False, index=True)
    role = Column(Enum(MessageRole), nullable=False)
    content = Column(Text, nullable=True)
    content_json = Column(JSONB, nullable=True)
    provider = Column(String, nullable=True)
    model = Column(String, nullable=True)
    token_usage_json = Column(JSONB, nullable=True)
    confidence_json = Column(JSONB, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    # Relationships
    conversation = relationship("Conversation", back_populates="messages")
    citations = relationship("RAGCitation", back_populates="conversation_message", lazy="dynamic")


class AuditEvent(Base):
    __tablename__ = "audit_events"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False)
    session_id = Column(UUID(as_uuid=True), ForeignKey("sessions.id"), nullable=True)
    actor_type = Column(String, nullable=False)
    actor_user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    actor_student_id = Column(UUID(as_uuid=True), ForeignKey("session_students.id"), nullable=True)
    event_type = Column(String, nullable=False, index=True)
    payload_json = Column(JSONB, default=dict, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    __table_args__ = (
        Index("ix_audit_events_tenant_session_created", "tenant_id", "session_id", "created_at"),
        Index("ix_audit_events_event_type_created", "event_type", "created_at"),
    )
