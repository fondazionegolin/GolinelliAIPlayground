"""Recurring calendar events: occurrences share series_id and the recurrence rule."""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "121_calendar_recurrence"
down_revision = "120_calendar_events"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("calendar_events", sa.Column("series_id", postgresql.UUID(as_uuid=True), nullable=True))
    op.add_column("calendar_events", sa.Column("recurrence", postgresql.JSONB(), nullable=True))
    op.create_index("ix_calendar_events_series_id", "calendar_events", ["series_id"])


def downgrade():
    op.drop_index("ix_calendar_events_series_id", table_name="calendar_events")
    op.drop_column("calendar_events", "recurrence")
    op.drop_column("calendar_events", "series_id")
