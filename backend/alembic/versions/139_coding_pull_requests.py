"""Vibe Lab: working copy per collaborator and pull requests."""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "139_coding_pull_requests"
down_revision = "138_coding_collaborators"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "coding_collaborators",
        sa.Column("branch_project_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("coding_projects.id", ondelete="SET NULL"), nullable=True),
    )
    # Common ancestor snapshot: versions are edited in place by autosave, so ids alone are not a stable base.
    op.add_column("coding_collaborators", sa.Column("base_files_json", postgresql.JSONB(), nullable=True))
    op.create_table(
        "coding_pull_requests",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("project_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("coding_projects.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("branch_project_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("coding_projects.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("author_student_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("session_students.id", ondelete="SET NULL"), nullable=True),
        sa.Column("title", sa.String(255), nullable=False),
        sa.Column("description", sa.Text(), nullable=False, server_default=""),
        sa.Column("status", sa.String(16), nullable=False, server_default="open"),
        sa.Column("base_files_json", postgresql.JSONB(), nullable=False, server_default="[]"),
        sa.Column("head_files_json", postgresql.JSONB(), nullable=False, server_default="[]"),
        sa.Column("test_files_json", postgresql.JSONB(), nullable=True),
        sa.Column("conflicts_json", postgresql.JSONB(), nullable=False, server_default="[]"),
        sa.Column("main_hash_at_test", sa.String(64), nullable=True),
        sa.Column("merged_version_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("decision_note", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("merged_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade():
    op.drop_table("coding_pull_requests")
    op.drop_column("coding_collaborators", "base_files_json")
    op.drop_column("coding_collaborators", "branch_project_id")
