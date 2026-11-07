"""Scope shared audio playback to a session instead of a whole class.

The old table only held ephemeral playback state (current playlist/position), so it is replaced, not migrated.
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "119_session_audio_playback"
down_revision = "118_licenses"
branch_labels = None
depends_on = None


def upgrade():
    op.drop_table("class_audio_playback")
    op.create_table("session_audio_playback",
        sa.Column("session_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("sessions.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("teacher_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("playlist_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("voice_lab_playlists.id", ondelete="SET NULL")),
        sa.Column("state", postgresql.JSONB(), nullable=False, server_default="{}"))


def downgrade():
    op.drop_table("session_audio_playback")
    op.create_table("class_audio_playback",
        sa.Column("class_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("classes.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("teacher_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("playlist_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("voice_lab_playlists.id", ondelete="SET NULL")),
        sa.Column("state", postgresql.JSONB(), nullable=False, server_default="{}"))
