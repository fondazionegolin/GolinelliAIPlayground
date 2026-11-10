"""Shared calendar events (classes, sessions, co-teachers) with 10-minute reminders."""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "120_calendar_events"
down_revision = "119_session_audio_playback"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "calendar_events",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("owner_teacher_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("title", sa.String(200), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("starts_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("ends_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("all_day", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("color", sa.String(20), nullable=False, server_default="#6366f1"),
        sa.Column("reminder_sent_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_calendar_events_tenant_id", "calendar_events", ["tenant_id"])
    op.create_index("ix_calendar_events_owner_teacher_id", "calendar_events", ["owner_teacher_id"])
    op.create_index("ix_calendar_events_starts_at", "calendar_events", ["starts_at"])
    op.create_index("ix_calendar_events_reminder_sent_at", "calendar_events", ["reminder_sent_at"])
    op.create_table(
        "calendar_event_targets",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("event_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("calendar_events.id", ondelete="CASCADE"), nullable=False),
        sa.Column("target_type", sa.String(16), nullable=False),
        sa.Column("target_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.UniqueConstraint("event_id", "target_type", "target_id", name="uq_calendar_event_target"),
    )
    op.create_index("ix_calendar_event_targets_event_id", "calendar_event_targets", ["event_id"])
    op.create_index("ix_calendar_event_targets_target_id", "calendar_event_targets", ["target_id"])


def downgrade():
    op.drop_table("calendar_event_targets")
    op.drop_table("calendar_events")
