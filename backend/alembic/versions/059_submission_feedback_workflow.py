"""add draft and per-answer submission feedback

Revision ID: 059_submission_feedback
Revises: 058_teacherbot_student_pub
Create Date: 2026-07-17 15:00:00.000000
"""
from alembic import op
import sqlalchemy as sa


revision = "059_submission_feedback"
down_revision = "058_teacherbot_student_pub"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("task_submissions", sa.Column("feedback_draft_json", sa.Text(), nullable=True))
    op.add_column("task_submissions", sa.Column("answer_feedback_json", sa.Text(), nullable=True))
    op.add_column("task_submissions", sa.Column("feedback_published_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column("task_submissions", "feedback_published_at")
    op.drop_column("task_submissions", "answer_feedback_json")
    op.drop_column("task_submissions", "feedback_draft_json")
