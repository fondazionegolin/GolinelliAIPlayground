"""add notebook project type and editor settings

Revision ID: 030_nb_proj_settings
Revises: 029_add_calendar_event_time
Create Date: 2026-04-08
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB


revision = '030_nb_proj_settings'
down_revision = '029_add_calendar_event_time'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('notebooks', sa.Column('project_type', sa.String(length=32), nullable=False, server_default='python'))
    op.add_column('notebooks', sa.Column('editor_settings', JSONB, nullable=False, server_default='{}'))


def downgrade():
    op.drop_column('notebooks', 'editor_settings')
    op.drop_column('notebooks', 'project_type')
