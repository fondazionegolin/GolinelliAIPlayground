"""add document draft version history

Revision ID: 056_document_versions
Revises: 055_submission_corrections
Create Date: 2026-07-15 10:00:00.000000
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "056_document_versions"
down_revision = "055_submission_corrections"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "document_draft_versions",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("draft_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("owner_teacher_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("title", sa.String(), nullable=False),
        sa.Column("doc_type", sa.String(), nullable=False),
        sa.Column("content_json", sa.Text(), nullable=False),
        sa.Column("label", sa.String(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["draft_id"], ["document_drafts.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["owner_teacher_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_document_draft_versions_draft_id", "document_draft_versions", ["draft_id"])
    op.create_index("ix_document_draft_versions_owner_teacher_id", "document_draft_versions", ["owner_teacher_id"])
    op.create_index("ix_document_draft_versions_created_at", "document_draft_versions", ["created_at"])


def downgrade() -> None:
    op.drop_index("ix_document_draft_versions_created_at", table_name="document_draft_versions")
    op.drop_index("ix_document_draft_versions_owner_teacher_id", table_name="document_draft_versions")
    op.drop_index("ix_document_draft_versions_draft_id", table_name="document_draft_versions")
    op.drop_table("document_draft_versions")
