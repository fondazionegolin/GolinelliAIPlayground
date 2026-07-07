"""add student submission task type

Revision ID: 052_student_submission_tasktype
Revises: 051_chat_collaboration
Create Date: 2026-07-07 17:40:00.000000
"""
from alembic import op


revision = "052_student_submission_tasktype"
down_revision = "051_chat_collaboration"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TYPE tasktype ADD VALUE IF NOT EXISTS 'student_submission'")


def downgrade() -> None:
    # PostgreSQL does not support dropping enum values safely.
    pass
