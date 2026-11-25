"""Vibe Lab: collaborators invited to a student's project."""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "138_coding_collaborators"
down_revision = "137_teacherbot_math_editor"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "coding_collaborators",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("project_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("coding_projects.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("student_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("session_students.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("status", sa.String(16), nullable=False, server_default="invited"),
        sa.Column("invited_by_student_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("session_students.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("project_id", "student_id", name="uq_coding_collaborators_project_student"),
    )


def downgrade():
    op.drop_table("coding_collaborators")
