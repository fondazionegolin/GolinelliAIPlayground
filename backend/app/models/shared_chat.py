from sqlalchemy import Column, String, DateTime, Boolean, ForeignKey, Text, func, Index, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
import uuid

from app.core.database import Base


class SharedChatRoom(Base):
    """A collaborative chat room shared by one student with peers in the same session.

    The room targets either a teacherbot or a predefined assistant profile; the bot
    answers every message except peer-only messages (an ``@nickname`` aimed at a
    participant).
    """
    __tablename__ = "shared_chat_rooms"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False, index=True)
    session_id = Column(UUID(as_uuid=True), ForeignKey("sessions.id"), nullable=False, index=True)
    owner_student_id = Column(UUID(as_uuid=True), ForeignKey("session_students.id"), nullable=False, index=True)
    kind = Column(String(20), nullable=False)  # 'teacherbot' | 'assistant'
    teacherbot_id = Column(UUID(as_uuid=True), ForeignKey("teacherbots.id"), nullable=True)
    profile_key = Column(String(64), nullable=True)
    title = Column(String(255), nullable=True)
    is_active = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    participants = relationship("SharedChatParticipant", back_populates="room", lazy="selectin", cascade="all, delete-orphan")
    messages = relationship("SharedChatMessage", back_populates="room", lazy="dynamic", cascade="all, delete-orphan")

    __table_args__ = (
        Index("ix_shared_chat_rooms_session_active", "session_id", "is_active"),
    )


class SharedChatParticipant(Base):
    __tablename__ = "shared_chat_participants"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    room_id = Column(UUID(as_uuid=True), ForeignKey("shared_chat_rooms.id", ondelete="CASCADE"), nullable=False, index=True)
    student_id = Column(UUID(as_uuid=True), ForeignKey("session_students.id"), nullable=False, index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    room = relationship("SharedChatRoom", back_populates="participants")
    student = relationship("SessionStudent")

    __table_args__ = (
        UniqueConstraint("room_id", "student_id", name="uq_shared_chat_participant"),
    )


class SharedChatMessage(Base):
    __tablename__ = "shared_chat_messages"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    room_id = Column(UUID(as_uuid=True), ForeignKey("shared_chat_rooms.id", ondelete="CASCADE"), nullable=False, index=True)
    sender_student_id = Column(UUID(as_uuid=True), ForeignKey("session_students.id"), nullable=True)  # null = bot
    role = Column(String(20), nullable=False)  # 'user' | 'assistant'
    sender_nickname = Column(String, nullable=True)  # denormalized for display
    content = Column(Text, nullable=False)
    is_peer = Column(Boolean, default=False, nullable=False)  # @mention peer-only (no bot reply)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    room = relationship("SharedChatRoom", back_populates="messages")

    __table_args__ = (
        Index("ix_shared_chat_messages_room_created", "room_id", "created_at"),
    )
