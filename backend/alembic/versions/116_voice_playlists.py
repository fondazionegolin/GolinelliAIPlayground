"""Ordered audio playlists shared through existing Drive permissions."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "116_voice_playlists"
down_revision = "115_voice_lab"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table("voice_lab_playlists",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("owner_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("title", sa.String(200), nullable=False),
        sa.Column("folder_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("drive_items.id", ondelete="CASCADE"), nullable=False, unique=True),
        sa.Column("track_ids", postgresql.JSONB(), nullable=False, server_default="[]"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()))
    op.create_index("ix_voice_lab_playlists_owner_id", "voice_lab_playlists", ["owner_id"])


def downgrade():
    op.drop_table("voice_lab_playlists")
