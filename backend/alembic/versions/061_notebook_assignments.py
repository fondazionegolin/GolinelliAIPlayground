"""add versioned notebook assignments

Revision ID: 061_notebook_assignments
Revises: 060_class_archive
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "061_notebook_assignments"
down_revision = "060_class_archive"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "notebook_assignments",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("teacher_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("session_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("sessions.id", ondelete="CASCADE"), nullable=False),
        sa.Column("task_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("tasks.id", ondelete="CASCADE"), nullable=False, unique=True),
        sa.Column("source_notebook_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("notebooks.id", ondelete="CASCADE"), nullable=False),
        sa.Column("source_version_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("notebook_versions.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("title", sa.String(255), nullable=False),
        sa.Column("project_type", sa.String(32), nullable=False),
        sa.Column("cells", postgresql.JSONB(), nullable=False),
        sa.Column("editor_settings", postgresql.JSONB(), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_notebook_assignments_tenant_id", "notebook_assignments", ["tenant_id"])
    op.create_index("ix_notebook_assignments_teacher_id", "notebook_assignments", ["teacher_id"])
    op.create_index("ix_notebook_assignments_session_id", "notebook_assignments", ["session_id"])
    op.create_index("ix_notebook_assignments_source_notebook_id", "notebook_assignments", ["source_notebook_id"])

    op.create_table(
        "notebook_forks",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("assignment_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("notebook_assignments.id", ondelete="CASCADE"), nullable=False),
        sa.Column("student_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("session_students.id", ondelete="CASCADE"), nullable=False),
        sa.Column("notebook_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("notebooks.id", ondelete="CASCADE"), nullable=False, unique=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("assignment_id", "student_id", name="uq_notebook_fork_assignment_student"),
    )
    op.create_index("ix_notebook_forks_assignment_id", "notebook_forks", ["assignment_id"])
    op.create_index("ix_notebook_forks_student_id", "notebook_forks", ["student_id"])


def downgrade():
    op.drop_table("notebook_forks")
    op.drop_table("notebook_assignments")
