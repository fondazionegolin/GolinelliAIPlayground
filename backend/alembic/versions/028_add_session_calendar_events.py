"""add session_calendar_events table

Revision ID: 028_add_session_calendar_events
Revises: 027_extend_wallpaper_key
Create Date: 2026-03-29
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = '028_add_session_calendar_events'
down_revision = '027_extend_wallpaper_key'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'session_calendar_events',
        sa.Column('id', UUID(as_uuid=True), primary_key=True),
        sa.Column('tenant_id', UUID(as_uuid=True), sa.ForeignKey('tenants.id', ondelete='CASCADE'), nullable=False, index=True),
        sa.Column('session_id', UUID(as_uuid=True), sa.ForeignKey('sessions.id', ondelete='CASCADE'), nullable=False, index=True),
        sa.Column('title', sa.String(200), nullable=False),
        sa.Column('description', sa.Text, nullable=True),
        sa.Column('event_date', sa.Date, nullable=False, index=True),
        sa.Column('color', sa.String(20), nullable=False, server_default='#6366f1'),
        sa.Column('created_by_teacher_id', UUID(as_uuid=True), sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )


def downgrade():
    op.drop_table('session_calendar_events')
