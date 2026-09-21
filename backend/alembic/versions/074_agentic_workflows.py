"""add persistent agentic workflows and runs

Revision ID: 074_agentic_workflows
Revises: 073_canvas_multi_doc
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "074_agentic_workflows"
down_revision = "073_canvas_multi_doc"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "agentic_workflows",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=True),
        sa.Column("created_by_user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("title", sa.String(180), nullable=False),
        sa.Column("status", sa.String(32), nullable=False, server_default="draft"),
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("graph_json", postgresql.JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_agentic_workflows_tenant_id", "agentic_workflows", ["tenant_id"])
    op.create_index("ix_agentic_workflows_created_by_user_id", "agentic_workflows", ["created_by_user_id"])

    op.create_table(
        "agentic_workflow_runs",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("workflow_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("agentic_workflows.id", ondelete="CASCADE"), nullable=False),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=True),
        sa.Column("created_by_user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("status", sa.String(32), nullable=False, server_default="queued"),
        sa.Column("input_json", postgresql.JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("output_json", postgresql.JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("artifacts_json", postgresql.JSONB(), nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_agentic_workflow_runs_workflow_id", "agentic_workflow_runs", ["workflow_id"])
    op.create_index("ix_agentic_workflow_runs_tenant_id", "agentic_workflow_runs", ["tenant_id"])
    op.create_index("ix_agentic_workflow_runs_created_by_user_id", "agentic_workflow_runs", ["created_by_user_id"])
    op.create_index("ix_agentic_workflow_runs_status", "agentic_workflow_runs", ["status"])

    op.create_table(
        "agentic_node_runs",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("run_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("agentic_workflow_runs.id", ondelete="CASCADE"), nullable=False),
        sa.Column("node_instance_id", sa.String(160), nullable=False),
        sa.Column("node_type", sa.String(80), nullable=False),
        sa.Column("label", sa.String(180), nullable=False),
        sa.Column("sequence", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(32), nullable=False, server_default="queued"),
        sa.Column("input_json", postgresql.JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("output_json", postgresql.JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("provider", sa.String(40), nullable=True),
        sa.Column("model", sa.String(160), nullable=True),
        sa.Column("prompt_tokens", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("completion_tokens", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("duration_ms", sa.Integer(), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint("run_id", "node_instance_id", name="uq_agentic_node_runs_run_node"),
    )
    op.create_index("ix_agentic_node_runs_run_id", "agentic_node_runs", ["run_id"])


def downgrade():
    op.drop_table("agentic_node_runs")
    op.drop_table("agentic_workflow_runs")
    op.drop_table("agentic_workflows")
