from sqlalchemy import Column, String, Enum, DateTime, ForeignKey, Text, func, Index
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import relationship
import uuid

from app.core.database import Base
from app.models.enums import ChatRoomType, SenderType


class ChatRoom(Base):
    __tablename__ = "chat_rooms"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False, index=True)
    session_id = Column(UUID(as_uuid=True), ForeignKey("sessions.id"), nullable=False, index=True)
    room_type = Column(Enum(ChatRoomType), nullable=False)
    student_id = Column(UUID(as_uuid=True), ForeignKey("session_students.id"), nullable=True)
    teacher_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    # Relationships
    session = relationship("Session", back_populates="chat_rooms")
    messages = relationship("ChatMessage", back_populates="room", lazy="dynamic")


class ChatMessage(Base):
    __tablename__ = "chat_messages"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False)
    session_id = Column(UUID(as_uuid=True), ForeignKey("sessions.id"), nullable=False)
    room_id = Column(UUID(as_uuid=True), ForeignKey("chat_rooms.id"), nullable=False)
    sender_type = Column(Enum(SenderType), nullable=False)
    sender_teacher_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    sender_student_id = Column(UUID(as_uuid=True), ForeignKey("session_students.id"), nullable=True)
    message_text = Column(Text, nullable=False)
    attachments = Column(JSONB, default=list, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    __table_args__ = (
        Index("ix_chat_messages_session_room_created", "session_id", "room_id", "created_at"),
    )

    # Relationships
    room = relationship("ChatRoom", back_populates="messages")
    sender_student = relationship("SessionStudent", back_populates="chat_messages")
