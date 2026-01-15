from sqlalchemy import Column, String, Enum, DateTime, Boolean, ForeignKey, Text, func
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import relationship
import uuid

from app.core.database import Base
from app.models.enums import SessionStatus


class Class(Base):
    __tablename__ = "classes"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False, index=True)
    teacher_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False, index=True)
    name = Column(String, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    # Relationships
    tenant = relationship("Tenant", back_populates="classes")
    teacher = relationship("User", back_populates="classes")
    sessions = relationship("Session", back_populates="class_", lazy="dynamic")


class Session(Base):
    __tablename__ = "sessions"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False, index=True)
    class_id = Column(UUID(as_uuid=True), ForeignKey("classes.id"), nullable=False, index=True)
    title = Column(String, nullable=False)
    join_code = Column(String(5), unique=True, nullable=False, index=True)
    status = Column(Enum(SessionStatus, values_callable=lambda x: [e.value for e in x]), default=SessionStatus.DRAFT, nullable=False)
    is_persistent = Column(Boolean, default=False, nullable=False)
    starts_at = Column(DateTime(timezone=True), nullable=True)
    ends_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    # Relationships
    tenant = relationship("Tenant", back_populates="sessions")
    class_ = relationship("Class", back_populates="sessions")
    modules = relationship("SessionModule", back_populates="session", lazy="dynamic")
    students = relationship("SessionStudent", back_populates="session", lazy="dynamic")
    chat_rooms = relationship("ChatRoom", back_populates="session", lazy="dynamic")
    conversations = relationship("Conversation", back_populates="session", lazy="dynamic", cascade="all, delete-orphan")


class SessionModule(Base):
    __tablename__ = "session_modules"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False, index=True)
    session_id = Column(UUID(as_uuid=True), ForeignKey("sessions.id"), nullable=False, index=True)
    module_key = Column(String, nullable=False)
    is_enabled = Column(Boolean, default=True, nullable=False)
    config_json = Column(JSONB, default=dict, nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    # Relationships
    session = relationship("Session", back_populates="modules")


class SessionStudent(Base):
    __tablename__ = "session_students"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False, index=True)
    session_id = Column(UUID(as_uuid=True), ForeignKey("sessions.id"), nullable=False, index=True)
    nickname = Column(String, nullable=False)
    join_token = Column(Text, unique=True, nullable=False)
    is_frozen = Column(Boolean, default=False, nullable=False)
    frozen_reason = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    last_seen_at = Column(DateTime(timezone=True), nullable=True)

    # Relationships
    session = relationship("Session", back_populates="students")
    conversations = relationship("Conversation", back_populates="student", lazy="dynamic")
    chat_messages = relationship("ChatMessage", back_populates="sender_student", lazy="dynamic")
