from sqlalchemy import Column, String, Enum, DateTime, Boolean, ForeignKey, Text, Float, func, Index
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import relationship
import uuid
import enum

from app.core.database import Base


class TeacherbotStatus(str, enum.Enum):
    DRAFT = "draft"
    TESTING = "testing"
    PUBLISHED = "published"
    ARCHIVED = "archived"


class Teacherbot(Base):
    """Custom GPT-like bot created by teachers"""
    __tablename__ = "teacherbots"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False, index=True)
    teacher_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False, index=True)
    name = Column(String(100), nullable=False)
    synopsis = Column(String(255), nullable=True)  # Brief description for card display
    description = Column(Text, nullable=True)  # Full description of bot functionality
    icon = Column(String(50), default="bot", nullable=False)  # Lucide icon name
    color = Column(String(20), default="indigo", nullable=False)  # Theme color
    system_prompt = Column(Text, nullable=False)  # The core system prompt
    is_proactive = Column(Boolean, default=False, nullable=False)
    proactive_message = Column(Text, nullable=True)  # Initial message if proactive
    enable_reporting = Column(Boolean, default=False, nullable=False)
    report_prompt = Column(Text, nullable=True)  # Custom prompt for report generation
    llm_provider = Column(String, nullable=True)  # Override default provider
    llm_model = Column(String, nullable=True)  # Override default model
    temperature = Column(Float, default=0.7, nullable=False)
    status = Column(
        Enum(TeacherbotStatus, values_callable=lambda x: [e.value for e in x]),
        default=TeacherbotStatus.DRAFT,
        nullable=False
    )
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)
    published_at = Column(DateTime(timezone=True), nullable=True)

    # Relationships
    teacher = relationship("User", backref="teacherbots")
    publications = relationship("TeacherbotPublication", back_populates="teacherbot", lazy="dynamic", cascade="all, delete-orphan")
    conversations = relationship("TeacherbotConversation", back_populates="teacherbot", lazy="dynamic", cascade="all, delete-orphan")

    __table_args__ = (
        Index("ix_teacherbots_teacher_status", "teacher_id", "status"),
    )


class TeacherbotPublication(Base):
    """Publication of a teacherbot to a class"""
    __tablename__ = "teacherbot_publications"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False, index=True)
    teacherbot_id = Column(UUID(as_uuid=True), ForeignKey("teacherbots.id"), nullable=False, index=True)
    class_id = Column(UUID(as_uuid=True), ForeignKey("classes.id"), nullable=False, index=True)
    is_active = Column(Boolean, default=True, nullable=False)
    published_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    published_by_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)

    # Relationships
    teacherbot = relationship("Teacherbot", back_populates="publications")
    class_ = relationship("Class", backref="teacherbot_publications")
    published_by = relationship("User", foreign_keys=[published_by_id])

    __table_args__ = (
        Index("ix_teacherbot_publications_class_active", "class_id", "is_active"),
    )


class TeacherbotConversation(Base):
    """Student conversation with a teacherbot"""
    __tablename__ = "teacherbot_conversations"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False, index=True)
    teacherbot_id = Column(UUID(as_uuid=True), ForeignKey("teacherbots.id"), nullable=False, index=True)
    student_id = Column(UUID(as_uuid=True), ForeignKey("session_students.id"), nullable=False, index=True)
    session_id = Column(UUID(as_uuid=True), ForeignKey("sessions.id"), nullable=False, index=True)
    title = Column(String(255), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)
    report_json = Column(JSONB, nullable=True)  # {summary, observations, message_count, etc.}
    report_generated_at = Column(DateTime(timezone=True), nullable=True)

    # Relationships
    teacherbot = relationship("Teacherbot", back_populates="conversations")
    student = relationship("SessionStudent", backref="teacherbot_conversations")
    session = relationship("Session", backref="teacherbot_conversations")
    messages = relationship("TeacherbotMessage", back_populates="conversation", lazy="dynamic", cascade="all, delete-orphan")

    __table_args__ = (
        Index("ix_teacherbot_conversations_teacherbot_student", "teacherbot_id", "student_id"),
        Index("ix_teacherbot_conversations_session", "session_id", "created_at"),
    )


class TeacherbotMessage(Base):
    """Messages in a teacherbot conversation"""
    __tablename__ = "teacherbot_messages"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False)
    conversation_id = Column(UUID(as_uuid=True), ForeignKey("teacherbot_conversations.id"), nullable=False, index=True)
    role = Column(String(20), nullable=False)  # 'user' or 'assistant'
    content = Column(Text, nullable=False)
    provider = Column(String, nullable=True)
    model = Column(String, nullable=True)
    token_usage_json = Column(JSONB, nullable=True)  # {prompt_tokens, completion_tokens, total_tokens}
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    # Relationships
    conversation = relationship("TeacherbotConversation", back_populates="messages")
