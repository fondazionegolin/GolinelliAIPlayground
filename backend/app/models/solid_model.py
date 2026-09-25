import uuid

from sqlalchemy import Boolean, CheckConstraint, Column, DateTime, ForeignKey, Index, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB, UUID

from app.core.database import Base


class SolidModel(Base):
    """3D Lab solid-modeler project (Tinkercad-like scene JSON), shareable with classes or via public link."""

    __tablename__ = "solid_models"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    # Exactly one owner: a teacher/admin user or a session student (when the session enables the 3D Lab).
    owner_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=True, index=True)
    owner_student_id = Column(UUID(as_uuid=True), ForeignKey("session_students.id", ondelete="CASCADE"), nullable=True)
    name = Column(String(160), nullable=False, default="Progetto senza titolo")
    scene = Column(JSONB, nullable=False, default=list)
    thumbnail = Column(Text, nullable=True)  # small data:image/webp URL rendered by the editor
    shared_class_ids = Column(JSONB, nullable=False, default=list, server_default="[]")
    public_token = Column(String(64), nullable=True, unique=True)
    public_enabled = Column(Boolean, nullable=False, default=False, server_default="false")
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())

    __table_args__ = (
        Index("ix_solid_models_owner_updated", "owner_id", "updated_at"),
        Index("ix_solid_models_owner_student_updated", "owner_student_id", "updated_at"),
        Index("ix_solid_models_shared_class_ids", "shared_class_ids", postgresql_using="gin"),
        CheckConstraint("(owner_id IS NOT NULL) <> (owner_student_id IS NOT NULL)", name="ck_solid_models_single_owner"),
    )
