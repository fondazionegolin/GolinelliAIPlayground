"""Personal student Files/playlists and persistent class audio playback."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "117_background_audio"
down_revision = "116_voice_playlists"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("files", sa.Column("audio_duration", sa.Float(), nullable=True))
    for table in ("drive_items", "voice_lab_playlists"):
        op.add_column(table, sa.Column("owner_student_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("session_students.id", ondelete="CASCADE"), nullable=True))
        op.create_index(f"ix_{table}_owner_student_id", table, ["owner_student_id"])
    op.create_table("class_audio_playback",
        sa.Column("class_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("classes.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("teacher_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("playlist_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("voice_lab_playlists.id", ondelete="SET NULL")),
        sa.Column("state", postgresql.JSONB(), nullable=False, server_default="{}"))


def downgrade():
    op.drop_table("class_audio_playback")
    for table in ("voice_lab_playlists", "drive_items"):
        op.drop_index(f"ix_{table}_owner_student_id", table)
        op.drop_column(table, "owner_student_id")
    op.drop_column("files", "audio_duration")
