"""Smart canvases: Figma-like boards with an AI that reads and draws on them."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "109_smart_canvases"
down_revision = "108_solid_model_ar"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "smart_canvases",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("owner_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("title", sa.String(200), nullable=False),
        sa.Column("content_json", sa.Text(), nullable=False, server_default='{"type":"canvas_v1","items":[]}'),
        sa.Column("messages", postgresql.JSONB(), nullable=False, server_default="[]"),
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_smart_canvases_owner_updated", "smart_canvases", ["owner_id", "updated_at"])


def downgrade():
    op.drop_index("ix_smart_canvases_owner_updated", table_name="smart_canvases")
    op.drop_table("smart_canvases")
