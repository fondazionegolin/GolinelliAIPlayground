"""Voice/video calls with invite codes, linkable to calendar events."""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "123_voice_calls"
down_revision = "122_smart_canvas_private"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "voice_calls",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("owner_teacher_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("title", sa.String(200), nullable=False),
        sa.Column("code", sa.String(16), nullable=False),
        sa.Column("session_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("sessions.id", ondelete="SET NULL"), nullable=True),
        sa.Column("class_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("classes.id", ondelete="SET NULL"), nullable=True),
        sa.Column("link_enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("open_to_teachers", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("last_started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_voice_calls_tenant_id", "voice_calls", ["tenant_id"])
    op.create_index("ix_voice_calls_owner_teacher_id", "voice_calls", ["owner_teacher_id"])
    op.create_index("ix_voice_calls_code", "voice_calls", ["code"], unique=True)
    op.create_index("ix_voice_calls_session_id", "voice_calls", ["session_id"])
    op.create_index("ix_voice_calls_class_id", "voice_calls", ["class_id"])
    op.add_column(
        "calendar_events",
        sa.Column("voice_call_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("voice_calls.id", ondelete="SET NULL"), nullable=True),
    )
    op.create_index("ix_calendar_events_voice_call_id", "calendar_events", ["voice_call_id"])


def downgrade():
    op.drop_index("ix_calendar_events_voice_call_id", table_name="calendar_events")
    op.drop_column("calendar_events", "voice_call_id")
    op.drop_table("voice_calls")
