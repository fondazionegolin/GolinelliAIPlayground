"""Private teacher Voice Lab library."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "115_voice_lab"
down_revision = "114_ai_model_scopes"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table("voice_lab_items",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("owner_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("title", sa.String(200), nullable=False), sa.Column("kind", sa.String(24), nullable=False),
        sa.Column("service", sa.String(32), nullable=False), sa.Column("provider_id", sa.String(120)),
        sa.Column("storage_key", sa.String(400)), sa.Column("mime_type", sa.String(120)),
        sa.Column("details", postgresql.JSONB(), nullable=False, server_default="{}"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_voice_lab_items_provider_id", "voice_lab_items", ["provider_id"])
    op.create_index("ix_voice_lab_owner_created", "voice_lab_items", ["owner_id", "created_at"])


def downgrade():
    op.drop_table("voice_lab_items")
