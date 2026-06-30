from sqlalchemy import Column, String, DateTime, ForeignKey, func
from sqlalchemy.dialects.postgresql import UUID, JSONB
import uuid

from app.core.database import Base


class NotebookVersion(Base):
    """Point-in-time snapshot of a notebook, used for the version history /
    rollback feature. A new row is created on meaningful checkpoints (manual
    save, before applying an AI proposal, before a restore, periodic autosave)."""

    __tablename__ = "notebook_versions"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    notebook_id = Column(UUID(as_uuid=True), ForeignKey("notebooks.id", ondelete="CASCADE"), nullable=False, index=True)
    tenant_id = Column(UUID(as_uuid=True), nullable=False, index=True)

    # Short human label, e.g. "Salvataggio manuale", "Prima della proposta AI".
    label = Column(String(160), nullable=False, default="Snapshot")
    # Origin tag: manual | ai | auto | rollback
    source = Column(String(32), nullable=False, default="manual")

    # Snapshot of the notebook state at creation time.
    title = Column(String(255), nullable=False, default="Nuovo Notebook")
    project_type = Column(String(32), nullable=False, default="python")
    cells = Column(JSONB, nullable=False, default=list)
    editor_settings = Column(JSONB, nullable=False, default=dict)

    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
