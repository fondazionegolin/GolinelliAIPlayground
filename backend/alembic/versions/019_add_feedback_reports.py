"""add feedback reports table

Revision ID: 019
Revises: 018
Create Date: 2026-03-24
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID, JSONB

revision = '019_add_feedback_reports'
down_revision = '018_add_invitation_group_tag'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'feedback_reports',
        sa.Column('id', UUID(as_uuid=True), primary_key=True, server_default=sa.text('gen_random_uuid()')),
        sa.Column('user_type', sa.String(20), nullable=False),
        sa.Column('user_id_ref', sa.String(64), nullable=True),
        sa.Column('user_display_name', sa.String(256), nullable=True),
        sa.Column('message', sa.Text, nullable=False),
        sa.Column('page_url', sa.String(512), nullable=True),
        sa.Column('browser_info', JSONB, nullable=False, server_default='{}'),
        sa.Column('console_errors', JSONB, nullable=False, server_default='[]'),
        sa.Column('status', sa.String(20), nullable=False, server_default='new'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    )
    op.create_index('ix_feedback_reports_created_at', 'feedback_reports', ['created_at'])
    op.create_index('ix_feedback_reports_status', 'feedback_reports', ['status'])


def downgrade():
    op.drop_table('feedback_reports')
