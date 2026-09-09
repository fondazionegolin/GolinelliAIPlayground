"""collaborative shared chat

Revision ID: 051_chat_collaboration
Revises: 050_teacherbot_live_voice
Create Date: 2026-06-30 17:30:00.000000
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "051_chat_collaboration"
down_revision = "050_teacherbot_live_voice"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "shared_chat_rooms",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("tenants.id"), nullable=False),
        sa.Column("session_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("sessions.id"), nullable=False),
        sa.Column("owner_student_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("session_students.id"), nullable=False),
        sa.Column("kind", sa.String(length=20), nullable=False),
        sa.Column("teacherbot_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("teacherbots.id"), nullable=True),
        sa.Column("profile_key", sa.String(length=64), nullable=True),
        sa.Column("title", sa.String(length=255), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_shared_chat_rooms_tenant_id", "shared_chat_rooms", ["tenant_id"])
    op.create_index("ix_shared_chat_rooms_session_id", "shared_chat_rooms", ["session_id"])
    op.create_index("ix_shared_chat_rooms_owner_student_id", "shared_chat_rooms", ["owner_student_id"])
    op.create_index("ix_shared_chat_rooms_session_active", "shared_chat_rooms", ["session_id", "is_active"])

    op.create_table(
        "shared_chat_participants",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("room_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("shared_chat_rooms.id", ondelete="CASCADE"), nullable=False),
        sa.Column("student_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("session_students.id"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("room_id", "student_id", name="uq_shared_chat_participant"),
    )
    op.create_index("ix_shared_chat_participants_room_id", "shared_chat_participants", ["room_id"])
    op.create_index("ix_shared_chat_participants_student_id", "shared_chat_participants", ["student_id"])

    op.create_table(
        "shared_chat_messages",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("room_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("shared_chat_rooms.id", ondelete="CASCADE"), nullable=False),
        sa.Column("sender_student_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("session_students.id"), nullable=True),
        sa.Column("role", sa.String(length=20), nullable=False),
        sa.Column("sender_nickname", sa.String(), nullable=True),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("is_peer", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_shared_chat_messages_room_id", "shared_chat_messages", ["room_id"])
    op.create_index("ix_shared_chat_messages_room_created", "shared_chat_messages", ["room_id", "created_at"])


def downgrade() -> None:
    op.drop_table("shared_chat_messages")
    op.drop_table("shared_chat_participants")
    op.drop_table("shared_chat_rooms")
