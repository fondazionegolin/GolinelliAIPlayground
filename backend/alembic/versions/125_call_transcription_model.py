"""Which speech-to-text engine/model transcribed a call recording."""
import sqlalchemy as sa
from alembic import op

revision = "125_call_transcription_model"
down_revision = "124_voice_call_recordings"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("voice_call_recordings", sa.Column("transcription_model", sa.String(80), nullable=True))


def downgrade():
    op.drop_column("voice_call_recordings", "transcription_model")
