"""Background jobs: long AI generations that survive page changes and reloads

Revision ID: 086_background_jobs
Revises: 085_chat_message_clock_ts
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "086_background_jobs"
down_revision = "085_chat_message_clock_ts"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "background_jobs",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("tenants.id"), nullable=False),
        sa.Column("owner_user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=True),
        sa.Column("owner_student_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("session_students.id", ondelete="CASCADE"), nullable=True),
        sa.Column("kind", sa.String(40), nullable=False),
        sa.Column("title", sa.String(200), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("route", sa.String(300), nullable=True),
        sa.Column("resource_id", sa.String(64), nullable=True),
        sa.Column("status", sa.String(16), nullable=False, server_default="running"),
        sa.Column("progress", sa.Float(), nullable=True),
        sa.Column("progress_label", sa.String(300), nullable=True),
        sa.Column("expected_seconds", sa.Float(), nullable=True),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("result_json", postgresql.JSONB(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("seen_at", sa.DateTime(timezone=True), nullable=True),
    )
    for col in ("tenant_id", "owner_user_id", "owner_student_id", "kind", "resource_id"):
        op.create_index(f"ix_background_jobs_{col}", "background_jobs", [col])
    # Teacher chat: a question and its reply saved in one transaction must not share created_at.
    op.alter_column("teacher_conversation_messages", "created_at", server_default=sa.text("clock_timestamp()"))


def downgrade():
    op.alter_column("teacher_conversation_messages", "created_at", server_default=sa.text("now()"))
    for col in ("tenant_id", "owner_user_id", "owner_student_id", "kind", "resource_id"):
        op.drop_index(f"ix_background_jobs_{col}", table_name="background_jobs")
    op.drop_table("background_jobs")
