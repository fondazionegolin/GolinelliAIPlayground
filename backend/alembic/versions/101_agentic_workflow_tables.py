"""Named persistent tables for Dataflow Studio workflows (db.* nodes).

Revision ID: 101_agentic_workflow_tables
Revises: 100_platform_settings
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "101_agentic_workflow_tables"
down_revision = "100_platform_settings"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "agentic_workflow_tables",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("workflow_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("agentic_workflows.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(80), nullable=False),
        sa.Column("columns", postgresql.JSONB(), nullable=False, server_default="[]"),
        sa.Column("rows", postgresql.JSONB(), nullable=False, server_default="[]"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("workflow_id", "name", name="uq_agentic_workflow_table_name"),
    )
    op.create_index("ix_agentic_workflow_tables_workflow_id", "agentic_workflow_tables", ["workflow_id"])


def downgrade():
    op.drop_index("ix_agentic_workflow_tables_workflow_id", table_name="agentic_workflow_tables")
    op.drop_table("agentic_workflow_tables")
