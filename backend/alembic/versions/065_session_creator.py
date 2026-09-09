"""track the teacher who created each session

Revision ID: 065_session_creator
Revises: 064_school_invites
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "065_session_creator"
down_revision = "064_school_invites"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "sessions",
        sa.Column(
            "created_by_teacher_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.create_index("ix_sessions_created_by_teacher_id", "sessions", ["created_by_teacher_id"])
    # Historical sessions predate creator tracking. Their safest owner is the
    # teacher who owns the containing class.
    op.execute("""
        UPDATE sessions
        SET created_by_teacher_id = classes.teacher_id
        FROM classes
        WHERE sessions.class_id = classes.id
          AND sessions.created_by_teacher_id IS NULL
    """)


def downgrade():
    op.drop_index("ix_sessions_created_by_teacher_id", table_name="sessions")
    op.drop_column("sessions", "created_by_teacher_id")
