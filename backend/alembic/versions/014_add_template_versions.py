"""add template versions history

Revision ID: 014_add_template_versions
Revises: 013_add_tenant_email_templates
Create Date: 2026-02-16
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "014_add_template_versions"
down_revision: Union[str, None] = "013_add_tenant_email_templates"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "tenant_template_versions",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("template_key", sa.String(length=64), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("subject", sa.Text(), nullable=True),
        sa.Column("html", sa.Text(), nullable=True),
        sa.Column("text", sa.Text(), nullable=True),
        sa.Column("updated_by_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"]),
        sa.ForeignKeyConstraint(["updated_by_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("tenant_id", "template_key", "version", name="uq_tenant_template_version"),
    )
    op.create_index(op.f("ix_tenant_template_versions_tenant_id"), "tenant_template_versions", ["tenant_id"], unique=False)
    op.create_index(op.f("ix_tenant_template_versions_template_key"), "tenant_template_versions", ["template_key"], unique=False)
    op.create_index(op.f("ix_tenant_template_versions_updated_by_id"), "tenant_template_versions", ["updated_by_id"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_tenant_template_versions_updated_by_id"), table_name="tenant_template_versions")
    op.drop_index(op.f("ix_tenant_template_versions_template_key"), table_name="tenant_template_versions")
    op.drop_index(op.f("ix_tenant_template_versions_tenant_id"), table_name="tenant_template_versions")
    op.drop_table("tenant_template_versions")
