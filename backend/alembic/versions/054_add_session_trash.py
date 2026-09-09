"""add session trash fields

Revision ID: 054_session_trash
Revises: 053_merge_heads
Create Date: 2026-07-08 12:00:00.000000
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "054_session_trash"
down_revision = "053_merge_heads"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("sessions", sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("sessions", sa.Column("deleted_by_id", postgresql.UUID(as_uuid=True), nullable=True))
    op.add_column("sessions", sa.Column("purge_after", sa.DateTime(timezone=True), nullable=True))
    op.create_index("ix_sessions_deleted_at", "sessions", ["deleted_at"])
    op.create_index("ix_sessions_deleted_by_id", "sessions", ["deleted_by_id"])
    op.create_index("ix_sessions_purge_after", "sessions", ["purge_after"])
    op.create_foreign_key("fk_sessions_deleted_by_id_users", "sessions", "users", ["deleted_by_id"], ["id"], ondelete="SET NULL")


def downgrade() -> None:
    op.drop_constraint("fk_sessions_deleted_by_id_users", "sessions", type_="foreignkey")
    op.drop_index("ix_sessions_purge_after", table_name="sessions")
    op.drop_index("ix_sessions_deleted_by_id", table_name="sessions")
    op.drop_index("ix_sessions_deleted_at", table_name="sessions")
    op.drop_column("sessions", "purge_after")
    op.drop_column("sessions", "deleted_by_id")
    op.drop_column("sessions", "deleted_at")
