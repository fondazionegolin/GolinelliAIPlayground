"""Recordings of plain session calls (no invite link): call_id becomes optional, call deletion keeps the recording."""
import sqlalchemy as sa
from alembic import op

revision = "126_session_call_recordings"
down_revision = "125_call_transcription_model"
branch_labels = None
depends_on = None

TABLE = "voice_call_recordings"


def _call_fk_name() -> str:
    """The FK name depends on the naming convention in force: look it up instead of guessing."""
    for fk in sa.inspect(op.get_bind()).get_foreign_keys(TABLE):
        if fk["constrained_columns"] == ["call_id"]:
            return fk["name"]
    raise RuntimeError("foreign key on voice_call_recordings.call_id not found")


def _replace_fk(ondelete: str) -> None:
    name = _call_fk_name()
    op.drop_constraint(name, TABLE, type_="foreignkey")
    op.create_foreign_key(name, TABLE, "voice_calls", ["call_id"], ["id"], ondelete=ondelete)


def upgrade():
    op.alter_column(TABLE, "call_id", nullable=True)
    _replace_fk("SET NULL")


def downgrade():
    op.execute(f"DELETE FROM {TABLE} WHERE call_id IS NULL")
    _replace_fk("CASCADE")
    op.alter_column(TABLE, "call_id", nullable=False)
