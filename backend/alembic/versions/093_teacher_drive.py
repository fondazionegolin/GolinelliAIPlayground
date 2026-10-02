"""Teacher drive: folders, files and artifact links with shares.

Revision ID: 093_teacher_drive
Revises: 092_live_escape_answers
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "093_teacher_drive"
down_revision = "092_live_escape_answers"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "drive_items",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=True),
        sa.Column("owner_teacher_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("parent_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("drive_items.id", ondelete="CASCADE"), nullable=True),
        sa.Column("kind", sa.String(16), nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("file_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("files.id", ondelete="CASCADE"), nullable=True),
        sa.Column("source_type", sa.String(32), nullable=True),
        sa.Column("source_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("mime_type", sa.String(255), nullable=True),
        sa.Column("size_bytes", sa.BigInteger(), nullable=True),
        sa.Column("class_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("classes.id", ondelete="SET NULL"), nullable=True),
        sa.Column("session_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("sessions.id", ondelete="SET NULL"), nullable=True),
        sa.Column("system_key", sa.String(160), nullable=True),
        sa.Column("is_system", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("is_hidden", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("starred", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("trashed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_by_student_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("session_students.id", ondelete="SET NULL"), nullable=True),
        sa.Column("public_token", sa.String(64), nullable=True, unique=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("owner_teacher_id", "system_key", name="uq_drive_items_owner_system_key"),
    )
    op.create_index("ix_drive_items_tenant_id", "drive_items", ["tenant_id"])
    op.create_index("ix_drive_items_owner_teacher_id", "drive_items", ["owner_teacher_id"])
    op.create_index("ix_drive_items_parent_id", "drive_items", ["parent_id"])
    op.create_index("ix_drive_items_file_id", "drive_items", ["file_id"])
    op.create_index("ix_drive_items_class_id", "drive_items", ["class_id"])
    op.create_index("ix_drive_items_session_id", "drive_items", ["session_id"])
    op.create_index("ix_drive_items_trashed_at", "drive_items", ["trashed_at"])
    op.create_index("ix_drive_items_owner_parent", "drive_items", ["owner_teacher_id", "parent_id"])
    op.create_index("ix_drive_items_source", "drive_items", ["source_type", "source_id"])

    op.create_table(
        "drive_shares",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("item_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("drive_items.id", ondelete="CASCADE"), nullable=False),
        sa.Column("target_type", sa.String(16), nullable=False),
        sa.Column("target_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("role", sa.String(16), nullable=False, server_default="viewer"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("item_id", "target_type", "target_id", name="uq_drive_shares_target"),
    )
    op.create_index("ix_drive_shares_item_id", "drive_shares", ["item_id"])
    op.create_index("ix_drive_shares_target", "drive_shares", ["target_type", "target_id"])


def downgrade():
    op.drop_table("drive_shares")
    op.drop_table("drive_items")
