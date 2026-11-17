"""Translated and spoken versions of call recordings (live help for students who do not speak Italian yet)."""
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql
from alembic import op

revision = "133_call_translations"
down_revision = "132_student_datasets"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("voice_call_analyses", sa.Column("language", sa.String(16), nullable=True))
    op.add_column("voice_call_analyses", sa.Column("source_kind", sa.String(16), nullable=True))
    op.add_column("voice_call_analyses", sa.Column("audio_key", sa.String(500), nullable=True))
    op.add_column("voice_call_analyses", sa.Column("audio_provider", sa.String(40), nullable=True))
    op.add_column("voice_call_analyses", sa.Column("audio_voice", sa.String(120), nullable=True))
    op.add_column("voice_call_analyses", sa.Column("audio_seconds", sa.Float(), nullable=True))
    op.add_column("voice_call_recordings", sa.Column("pipeline", postgresql.JSONB(), nullable=True))


def downgrade():
    op.drop_column("voice_call_recordings", "pipeline")
    for column in ("audio_seconds", "audio_voice", "audio_provider", "audio_key", "source_kind", "language"):
        op.drop_column("voice_call_analyses", column)
