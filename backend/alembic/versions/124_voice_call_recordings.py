"""Call recordings: per-speaker audio segments, merged transcript, AI analyses."""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "124_voice_call_recordings"
down_revision = "123_voice_calls"
branch_labels = None
depends_on = None

UUID = postgresql.UUID(as_uuid=True)


def upgrade():
    op.create_table(
        "voice_call_recordings",
        sa.Column("id", UUID, primary_key=True),
        sa.Column("tenant_id", UUID, sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("call_id", UUID, sa.ForeignKey("voice_calls.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("session_id", UUID, sa.ForeignKey("sessions.id", ondelete="SET NULL"), nullable=True, index=True),
        sa.Column("started_by_teacher_id", UUID, sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("title", sa.String(200), nullable=False),
        sa.Column("status", sa.String(16), nullable=False, server_default="recording"),
        sa.Column("started_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("ended_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("duration_seconds", sa.Integer(), nullable=True),
        sa.Column("transcript", postgresql.JSONB(), nullable=True),
        sa.Column("participants", postgresql.JSONB(), nullable=True),
        sa.Column("knowledge_document_id", UUID, nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_table(
        "voice_call_recording_segments",
        sa.Column("id", UUID, primary_key=True),
        sa.Column("recording_id", UUID, sa.ForeignKey("voice_call_recordings.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("identity", sa.String(200), nullable=False),
        sa.Column("speaker_name", sa.String(200), nullable=False),
        sa.Column("offset_ms", sa.Integer(), nullable=False),
        sa.Column("duration_ms", sa.Integer(), nullable=False),
        sa.Column("storage_key", sa.String(500), nullable=False),
        sa.Column("transcript", postgresql.JSONB(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_table(
        "voice_call_analyses",
        sa.Column("id", UUID, primary_key=True),
        sa.Column("recording_id", UUID, sa.ForeignKey("voice_call_recordings.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("kind", sa.String(32), nullable=False),
        sa.Column("title", sa.String(200), nullable=False),
        sa.Column("prompt", sa.Text(), nullable=True),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("created_by_teacher_id", UUID, sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("knowledge_document_id", UUID, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )


def downgrade():
    op.drop_table("voice_call_analyses")
    op.drop_table("voice_call_recording_segments")
    op.drop_table("voice_call_recordings")
