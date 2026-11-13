"""Anonymous view/edit links for native documents and presentations."""
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql
from alembic import op

revision = "127_document_share_links"
down_revision = "126_session_call_recordings"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table("document_share_links",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("token", sa.String(64), nullable=False),
        sa.Column("permission", sa.String(8), nullable=False),
        sa.Column("draft_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("document_drafts.id", ondelete="CASCADE")),
        sa.Column("task_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("tasks.id", ondelete="CASCADE")),
        sa.Column("asset_ids", postgresql.JSONB(), nullable=False, server_default="[]"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("revoked_at", sa.DateTime(timezone=True)),
        sa.CheckConstraint("(draft_id IS NULL) <> (task_id IS NULL)", name="one_source"),
        sa.CheckConstraint("permission IN ('view', 'edit')", name="permission"),
    )
    op.create_index("ix_document_share_links_token", "document_share_links", ["token"], unique=True)
    op.create_index("ix_document_share_links_draft_id", "document_share_links", ["draft_id"])
    op.create_index("ix_document_share_links_task_id", "document_share_links", ["task_id"])


def downgrade():
    op.drop_table("document_share_links")
