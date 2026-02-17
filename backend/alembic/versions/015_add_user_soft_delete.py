"""add user soft delete fields

Revision ID: 015_add_user_soft_delete
Revises: 014_add_template_versions
Create Date: 2026-02-16
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "015_add_user_soft_delete"
down_revision: Union[str, None] = "014_add_template_versions"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("users", sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")))
    op.add_column("users", sa.Column("deactivated_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("users", sa.Column("deactivated_by_admin_id", postgresql.UUID(as_uuid=True), nullable=True))
    op.create_index(op.f("ix_users_deactivated_by_admin_id"), "users", ["deactivated_by_admin_id"], unique=False)
    op.create_foreign_key(
        op.f("fk_users_deactivated_by_admin_id_users"),
        "users",
        "users",
        ["deactivated_by_admin_id"],
        ["id"],
    )


def downgrade() -> None:
    op.drop_constraint(op.f("fk_users_deactivated_by_admin_id_users"), "users", type_="foreignkey")
    op.drop_index(op.f("ix_users_deactivated_by_admin_id"), table_name="users")
    op.drop_column("users", "deactivated_by_admin_id")
    op.drop_column("users", "deactivated_at")
    op.drop_column("users", "is_active")
