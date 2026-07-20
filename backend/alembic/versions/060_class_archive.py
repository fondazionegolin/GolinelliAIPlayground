"""add recoverable class archive

Revision ID: 060_class_archive
Revises: 059_submission_feedback
Create Date: 2026-07-17 15:30:00.000000
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "060_class_archive"
down_revision = "059_submission_feedback"
branch_labels = None
depends_on = None

def upgrade() -> None:
    op.add_column("classes", sa.Column("archived_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("classes", sa.Column("archived_by_id", postgresql.UUID(as_uuid=True), nullable=True))
    op.create_index("ix_classes_archived_at", "classes", ["archived_at"])
    op.create_foreign_key("fk_classes_archived_by_id_users", "classes", "users", ["archived_by_id"], ["id"], ondelete="SET NULL")

def downgrade() -> None:
    op.drop_constraint("fk_classes_archived_by_id_users", "classes", type_="foreignkey")
    op.drop_index("ix_classes_archived_at", table_name="classes")
    op.drop_column("classes", "archived_by_id")
    op.drop_column("classes", "archived_at")
