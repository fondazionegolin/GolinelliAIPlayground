from sqlalchemy import Column, String, DateTime, ForeignKey, func
from sqlalchemy.dialects.postgresql import UUID, JSONB
import uuid

from app.core.database import Base


class Notebook(Base):
    __tablename__ = "notebooks"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    # owner_id can be either a User.id (teacher) or a SessionStudent.id (student) — no FK constraint
    owner_id = Column(UUID(as_uuid=True), nullable=False, index=True)

    title = Column(String(255), nullable=False, default="Nuovo Notebook")
    project_type = Column(String(32), nullable=False, default="python", server_default="python")
    # Array of cell objects:
    # { id, type: "code"|"markdown", source, outputs: [...], execution_count }
    cells = Column(JSONB, nullable=False, default=list)
    editor_settings = Column(JSONB, nullable=False, default=dict, server_default="{}")
    tutor_messages = Column(JSONB, nullable=False, default=list, server_default="[]")

    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)
