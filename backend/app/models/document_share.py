import uuid
from sqlalchemy import Column, String, DateTime, ForeignKey, CheckConstraint, func
from sqlalchemy.dialects.postgresql import UUID, JSONB
from app.core.database import Base


class DocumentShareLink(Base):
    __tablename__ = "document_share_links"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    token = Column(String(64), nullable=False, unique=True, index=True)
    permission = Column(String(8), nullable=False)
    draft_id = Column(UUID(as_uuid=True), ForeignKey("document_drafts.id", ondelete="CASCADE"), nullable=True, index=True)
    task_id = Column(UUID(as_uuid=True), ForeignKey("tasks.id", ondelete="CASCADE"), nullable=True, index=True)
    # File grants are captured by the authenticated sharer, never expanded by anonymous edits.
    asset_ids = Column(JSONB, nullable=False, default=list)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    revoked_at = Column(DateTime(timezone=True), nullable=True)
    __table_args__ = (
        CheckConstraint("(draft_id IS NULL) <> (task_id IS NULL)", name="one_source"),
        CheckConstraint("permission IN ('view', 'edit')", name="permission"),
    )
