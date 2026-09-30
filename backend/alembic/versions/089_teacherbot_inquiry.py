"""Teacherbot inquiry mode (investigative NPC voice interview)

Revision ID: 089_teacherbot_inquiry
Revises: 088_ui_theme
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "089_teacherbot_inquiry"
down_revision = "088_ui_theme"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("teacherbots", sa.Column("enable_inquiry", sa.Boolean(), nullable=False, server_default=sa.false()))
    op.add_column("teacherbots", sa.Column("inquiry_config", postgresql.JSONB(), nullable=True))
    op.create_table(
        "inquiry_sessions",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("teacherbot_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("teacherbots.id", ondelete="CASCADE"), nullable=False),
        sa.Column("student_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("session_students.id", ondelete="CASCADE"), nullable=True),
        sa.Column("teacher_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=True),
        sa.Column("status", sa.String(16), nullable=False, server_default="active"),
        sa.Column("unlocked_clue_ids", postgresql.JSONB(), nullable=False, server_default="[]"),
        sa.Column("trust", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("pressure", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("turn_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("attempts", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("final_answer", sa.Text(), nullable=True),
        sa.Column("verdict", postgresql.JSONB(), nullable=True),
        sa.Column("transcript", postgresql.JSONB(), nullable=False, server_default="[]"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_inquiry_sessions_teacherbot_id", "inquiry_sessions", ["teacherbot_id"])
    op.create_index("ix_inquiry_sessions_student_id", "inquiry_sessions", ["student_id"])
    op.create_index("ix_inquiry_sessions_teacher_id", "inquiry_sessions", ["teacher_id"])
    op.create_index("ix_inquiry_sessions_bot_student", "inquiry_sessions", ["teacherbot_id", "student_id"])


def downgrade():
    op.drop_table("inquiry_sessions")
    op.drop_column("teacherbots", "inquiry_config")
    op.drop_column("teacherbots", "enable_inquiry")
