"""Saved chat history of the Dataflow Studio assistant.

Revision ID: 102_agentic_assistant_chats
Revises: 101_agentic_workflow_tables
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "102_agentic_assistant_chats"
down_revision = "101_agentic_workflow_tables"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "agentic_assistant_conversations",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("created_by_user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("workflow_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("agentic_workflows.id", ondelete="SET NULL"), nullable=True),
        sa.Column("title", sa.String(180), nullable=False, server_default="Nuova conversazione"),
        sa.Column("messages", postgresql.JSONB(), nullable=False, server_default="[]"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_agentic_assistant_conversations_user", "agentic_assistant_conversations", ["created_by_user_id"])
    op.create_index("ix_agentic_assistant_conversations_workflow", "agentic_assistant_conversations", ["workflow_id"])


def downgrade():
    op.drop_index("ix_agentic_assistant_conversations_workflow", table_name="agentic_assistant_conversations")
    op.drop_index("ix_agentic_assistant_conversations_user", table_name="agentic_assistant_conversations")
    op.drop_table("agentic_assistant_conversations")
