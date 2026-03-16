"""add UDA support to tasks

Revision ID: 017_add_uda_support
Revises: 016_add_content_alerts
Create Date: 2026-03-16
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "017_add_uda_support"
down_revision: Union[str, None] = "016_add_content_alerts"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Add 'uda' to the tasktype enum
    op.execute("ALTER TYPE tasktype ADD VALUE IF NOT EXISTS 'uda'")

    # Make session_id nullable (UDA tasks live at class level, not session level)
    op.alter_column("tasks", "session_id", nullable=True)

    # Add class_id FK for class-level tasks (UDAs)
    op.add_column(
        "tasks",
        sa.Column(
            "class_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("classes.id", ondelete="CASCADE"),
            nullable=True,
            index=True,
        ),
    )

    # Add parent_uda_id self-referential FK for child tasks inside a UDA
    op.add_column(
        "tasks",
        sa.Column(
            "parent_uda_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("tasks.id", ondelete="CASCADE"),
            nullable=True,
            index=True,
        ),
    )

    # Add uda_phase for tracking UDA workflow state
    op.add_column(
        "tasks",
        sa.Column("uda_phase", sa.String(50), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("tasks", "uda_phase")
    op.drop_column("tasks", "parent_uda_id")
    op.drop_column("tasks", "class_id")
    op.alter_column("tasks", "session_id", nullable=False)
    # Note: PostgreSQL does not support removing enum values easily
