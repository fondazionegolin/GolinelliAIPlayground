"""add event_time to session_calendar_events

Revision ID: 029
Revises: 028
Create Date: 2026-03-29
"""
from alembic import op
import sqlalchemy as sa

revision = '029_add_calendar_event_time'
down_revision = '028_add_session_calendar_events'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        'session_calendar_events',
        sa.Column('event_time', sa.Time, nullable=True)
    )


def downgrade():
    op.drop_column('session_calendar_events', 'event_time')
