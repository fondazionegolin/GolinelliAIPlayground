"""add teacherbot share links (public link + access code + expiry)

Revision ID: 057_teacherbot_share_links
Revises: 056_document_versions
Create Date: 2026-07-16 10:00:00.000000
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "057_teacherbot_share_links"
down_revision = "056_document_versions"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "teacherbot_share_links",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("teacherbot_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("created_by_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("token", sa.String(), nullable=False),
        sa.Column("access_code", sa.String(12), nullable=False),
        sa.Column("label", sa.String(120), nullable=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("is_active", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"]),
        sa.ForeignKeyConstraint(["teacherbot_id"], ["teacherbots.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["created_by_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("token", name="uq_teacherbot_share_links_token"),
    )
    op.create_index("ix_teacherbot_share_links_token", "teacherbot_share_links", ["token"])
    op.create_index("ix_teacherbot_share_links_teacherbot_active", "teacherbot_share_links", ["teacherbot_id", "is_active"])

    op.create_table(
        "teacherbot_share_conversations",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("share_link_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("visitor_label", sa.String(120), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"]),
        sa.ForeignKeyConstraint(["share_link_id"], ["teacherbot_share_links.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_teacherbot_share_conversations_link_created",
        "teacherbot_share_conversations",
        ["share_link_id", "created_at"],
    )

    op.create_table(
        "teacherbot_share_messages",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("conversation_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("role", sa.String(20), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("provider", sa.String(), nullable=True),
        sa.Column("model", sa.String(), nullable=True),
        sa.Column("token_usage_json", postgresql.JSONB(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"]),
        sa.ForeignKeyConstraint(["conversation_id"], ["teacherbot_share_conversations.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_teacherbot_share_messages_conversation_created",
        "teacherbot_share_messages",
        ["conversation_id", "created_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_teacherbot_share_messages_conversation_created", table_name="teacherbot_share_messages")
    op.drop_table("teacherbot_share_messages")

    op.drop_index("ix_teacherbot_share_conversations_link_created", table_name="teacherbot_share_conversations")
    op.drop_table("teacherbot_share_conversations")

    op.drop_index("ix_teacherbot_share_links_teacherbot_active", table_name="teacherbot_share_links")
    op.drop_index("ix_teacherbot_share_links_token", table_name="teacherbot_share_links")
    op.drop_table("teacherbot_share_links")
