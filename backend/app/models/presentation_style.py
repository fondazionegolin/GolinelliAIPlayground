import uuid

from sqlalchemy import Column, DateTime, ForeignKey, String, func
from sqlalchemy.dialects.postgresql import JSONB, UUID

from app.core.database import Base


class PresentationStyle(Base):
    """A named slide style (background, title/body font, size, colour) saved by a teacher or student.

    Applied deterministically to one slide or to a whole deck (see app.services.presentation_styles)."""

    __tablename__ = "presentation_styles"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    owner_user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=True, index=True)
    owner_student_id = Column(UUID(as_uuid=True), ForeignKey("session_students.id", ondelete="CASCADE"), nullable=True, index=True)
    name = Column(String(120), nullable=False)
    style_json = Column(JSONB, nullable=False, default=dict, server_default="{}")
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)
