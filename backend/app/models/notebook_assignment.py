import uuid

from sqlalchemy import Boolean, Column, DateTime, ForeignKey, String, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import JSONB, UUID

from app.core.database import Base


class NotebookAssignment(Base):
    """Versioned teacher notebook template published to one session."""

    __tablename__ = "notebook_assignments"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    teacher_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    session_id = Column(UUID(as_uuid=True), ForeignKey("sessions.id", ondelete="CASCADE"), nullable=False, index=True)
    task_id = Column(UUID(as_uuid=True), ForeignKey("tasks.id", ondelete="CASCADE"), nullable=False, unique=True)
    source_notebook_id = Column(UUID(as_uuid=True), ForeignKey("notebooks.id", ondelete="CASCADE"), nullable=False, index=True)
    source_version_id = Column(UUID(as_uuid=True), ForeignKey("notebook_versions.id", ondelete="RESTRICT"), nullable=False)
    title = Column(String(255), nullable=False)
    project_type = Column(String(32), nullable=False)
    cells = Column(JSONB, nullable=False, default=list)
    editor_settings = Column(JSONB, nullable=False, default=dict)
    is_active = Column(Boolean, nullable=False, default=True, server_default="true")
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())


class NotebookFork(Base):
    """Independent student copy created from a published assignment version."""

    __tablename__ = "notebook_forks"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    assignment_id = Column(UUID(as_uuid=True), ForeignKey("notebook_assignments.id", ondelete="CASCADE"), nullable=False, index=True)
    student_id = Column(UUID(as_uuid=True), ForeignKey("session_students.id", ondelete="CASCADE"), nullable=False, index=True)
    notebook_id = Column(UUID(as_uuid=True), ForeignKey("notebooks.id", ondelete="CASCADE"), nullable=False, unique=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())

    __table_args__ = (UniqueConstraint("assignment_id", "student_id", name="uq_notebook_fork_assignment_student"),)
