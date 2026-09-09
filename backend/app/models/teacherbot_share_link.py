from sqlalchemy import Column, String, DateTime, Boolean, ForeignKey, Text, func, Index
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import relationship
import uuid

from app.core.database import Base


class TeacherbotShareLink(Base):
    """Public link (token + access code + expiry) to chat with a single teacherbot, no login required"""
    __tablename__ = "teacherbot_share_links"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False, index=True)
    teacherbot_id = Column(UUID(as_uuid=True), ForeignKey("teacherbots.id", ondelete="CASCADE"), nullable=False, index=True)
    created_by_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    token = Column(String, unique=True, nullable=False, index=True)
    access_code = Column(String(12), nullable=False)
    label = Column(String(120), nullable=True)
    expires_at = Column(DateTime(timezone=True), nullable=False)
    is_active = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    revoked_at = Column(DateTime(timezone=True), nullable=True)

    teacherbot = relationship("Teacherbot", backref="share_links")
    created_by = relationship("User", foreign_keys=[created_by_id])
    conversations = relationship("TeacherbotShareConversation", back_populates="share_link", lazy="dynamic", cascade="all, delete-orphan")

    __table_args__ = (
        Index("ix_teacherbot_share_links_teacherbot_active", "teacherbot_id", "is_active"),
    )


class TeacherbotShareConversation(Base):
    """Anonymous visitor conversation opened via a TeacherbotShareLink"""
    __tablename__ = "teacherbot_share_conversations"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False, index=True)
    share_link_id = Column(UUID(as_uuid=True), ForeignKey("teacherbot_share_links.id", ondelete="CASCADE"), nullable=False, index=True)
    visitor_label = Column(String(120), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    share_link = relationship("TeacherbotShareLink", back_populates="conversations")
    messages = relationship("TeacherbotShareMessage", back_populates="conversation", lazy="dynamic", cascade="all, delete-orphan")

    __table_args__ = (
        Index("ix_teacherbot_share_conversations_link_created", "share_link_id", "created_at"),
    )


class TeacherbotShareMessage(Base):
    """Message inside a TeacherbotShareConversation"""
    __tablename__ = "teacherbot_share_messages"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False)
    conversation_id = Column(UUID(as_uuid=True), ForeignKey("teacherbot_share_conversations.id", ondelete="CASCADE"), nullable=False, index=True)
    role = Column(String(20), nullable=False)  # 'user' or 'assistant'
    content = Column(Text, nullable=False)
    provider = Column(String, nullable=True)
    model = Column(String, nullable=True)
    token_usage_json = Column(JSONB, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    conversation = relationship("TeacherbotShareConversation", back_populates="messages")

    __table_args__ = (
        Index("ix_teacherbot_share_messages_conversation_created", "conversation_id", "created_at"),
    )
