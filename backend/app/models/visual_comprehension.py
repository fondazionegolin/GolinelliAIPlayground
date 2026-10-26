import uuid

from sqlalchemy import Column, DateTime, ForeignKey, Index, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB, UUID

from app.core.database import Base


class VisualComprehensionSession(Base):
    __tablename__ = "visual_comprehension_sessions"
    __table_args__ = (Index("ix_visual_sessions_owner_updated", "owner_id", "updated_at"),)

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    owner_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    title = Column(String(200), nullable=False)
    image_key = Column(String(300), nullable=False)
    image_name = Column(String(250), nullable=False)
    image_width = Column(Integer, nullable=False)
    image_height = Column(Integer, nullable=False)
    inventory = Column(JSONB, nullable=True)
    dialogue = Column(JSONB, nullable=False, default=dict)
    messages = Column(JSONB, nullable=False, default=list)
    draft = Column(Text, nullable=False, default="")
    revision = Column(Integer, nullable=False, default=0)
    active_request_id = Column(UUID(as_uuid=True), nullable=True)
    request_started_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())
