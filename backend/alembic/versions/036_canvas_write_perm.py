"""Add students_can_write to session_canvas

Revision ID: 036_canvas_write_perm
Revises: 035_add_feedback_user_email
Create Date: 2026-05-18
"""

from alembic import op

revision = '036_canvas_write_perm'
down_revision = '035_add_feedback_user_email'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE session_canvas ADD COLUMN IF NOT EXISTS students_can_write BOOLEAN NOT NULL DEFAULT false"
    )


def downgrade() -> None:
    op.drop_column('session_canvas', 'students_can_write')
