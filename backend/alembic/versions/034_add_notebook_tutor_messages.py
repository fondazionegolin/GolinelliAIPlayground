"""add notebook tutor messages persistence

Revision ID: 034_notebook_tutor_messages
Revises: 033_add_session_student_password_hash
Create Date: 2026-04-22
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB


revision = '034_notebook_tutor_messages'
down_revision = '033_student_pw_hash'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('notebooks', sa.Column('tutor_messages', JSONB, nullable=False, server_default='[]'))


def downgrade():
    op.drop_column('notebooks', 'tutor_messages')
