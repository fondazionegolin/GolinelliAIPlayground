"""add tracked corrections to task submissions

Revision ID: 055_submission_corrections
Revises: 054_session_trash
Create Date: 2026-07-13 12:00:00.000000
"""
from alembic import op
import sqlalchemy as sa


revision = "055_submission_corrections"
down_revision = "054_session_trash"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("task_submissions", sa.Column("corrections_json", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("task_submissions", "corrections_json")
