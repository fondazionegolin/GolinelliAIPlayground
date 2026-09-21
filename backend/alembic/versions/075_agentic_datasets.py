"""add agentic dataset library

Revision ID: 075_agentic_datasets
Revises: 074_agentic_workflows
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "075_agentic_datasets"
down_revision = "074_agentic_workflows"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "agentic_datasets",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=True),
        sa.Column("created_by_user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("title", sa.String(180), nullable=False),
        sa.Column("source", sa.String(20), nullable=False, server_default="ai"),
        sa.Column("row_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("table_json", postgresql.JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_agentic_datasets_tenant_id", "agentic_datasets", ["tenant_id"])
    op.create_index("ix_agentic_datasets_created_by_user_id", "agentic_datasets", ["created_by_user_id"])


def downgrade():
    op.drop_table("agentic_datasets")
