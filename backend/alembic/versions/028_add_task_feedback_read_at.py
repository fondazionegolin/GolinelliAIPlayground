"""track when a student reads published task feedback

Revision ID: 062_task_feedback_read_at
Revises: 061_notebook_assignments
Create Date: 2026-07-17
"""
from alembic import op
import sqlalchemy as sa

revision = '062_task_feedback_read_at'
down_revision = '061_notebook_assignments'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('task_submissions', sa.Column('feedback_read_at', sa.DateTime(timezone=True), nullable=True))


def downgrade():
    op.drop_column('task_submissions', 'feedback_read_at')
