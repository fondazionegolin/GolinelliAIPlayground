from sqlalchemy import Column, String, DateTime, ForeignKey, Boolean, Text, func
from sqlalchemy.dialects.postgresql import UUID, JSONB
import uuid

from app.core.database import Base


class PlatformChangelogRelease(Base):
    __tablename__ = "platform_changelog_releases"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    created_by_admin_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)

    version_label = Column(String(64), nullable=False)
    title = Column(String(160), nullable=False)
    summary = Column(Text, nullable=True)
    items_json = Column(JSONB, nullable=False, default=list, server_default="[]")
    git_ref = Column(String(120), nullable=True)

    is_published = Column(Boolean, nullable=False, default=True, server_default="true")
    published_at = Column(DateTime(timezone=True), nullable=True, index=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)
