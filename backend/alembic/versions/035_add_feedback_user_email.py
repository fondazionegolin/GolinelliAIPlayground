"""add user_email to feedback_reports

Revision ID: 035_add_feedback_user_email
Revises: 034_notebook_tutor_messages
Create Date: 2026-05-15
"""
from alembic import op
import sqlalchemy as sa

revision = '035_add_feedback_user_email'
down_revision = '034_notebook_tutor_messages'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "feedback_reports",
        sa.Column("user_email", sa.String(256), nullable=True),
    )


def downgrade():
    op.drop_column("feedback_reports", "user_email")
