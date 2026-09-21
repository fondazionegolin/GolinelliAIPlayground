"""add live escape room sessions

Revision ID: 078_live_escape_rooms
Revises: 077_teacherbot_escape_room
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "078_live_escape_rooms"
down_revision = "077_teacherbot_escape_room"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("live_interactions", sa.Column("interaction_type", sa.String(), nullable=False, server_default="slides"))
    op.add_column("live_interactions", sa.Column("teacherbot_id", postgresql.UUID(as_uuid=True), nullable=True))
    op.add_column("live_interactions", sa.Column("escape_config_json", postgresql.JSONB(), nullable=True))
    op.add_column("live_interactions", sa.Column("started_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("live_interactions", sa.Column("ended_at", sa.DateTime(timezone=True), nullable=True))
    op.create_foreign_key("fk_live_interactions_teacherbot", "live_interactions", "teacherbots", ["teacherbot_id"], ["id"])
    op.create_index("ix_live_interactions_teacherbot_id", "live_interactions", ["teacherbot_id"])

    op.create_table(
        "live_escape_participants",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("live_interaction_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("live_interactions.id", ondelete="CASCADE"), nullable=False),
        sa.Column("student_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("session_students.id", ondelete="CASCADE"), nullable=False),
        sa.Column("current_step", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("attempts", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("inventory_json", postgresql.JSONB(), nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("live_interaction_id", "student_id", name="uq_live_escape_participant"),
    )
    op.create_index("ix_live_escape_participants_live_interaction_id", "live_escape_participants", ["live_interaction_id"])
    op.create_index("ix_live_escape_participants_student_id", "live_escape_participants", ["student_id"])


def downgrade():
    op.drop_table("live_escape_participants")
    op.drop_index("ix_live_interactions_teacherbot_id", table_name="live_interactions")
    op.drop_constraint("fk_live_interactions_teacherbot", "live_interactions", type_="foreignkey")
    op.drop_column("live_interactions", "ended_at")
    op.drop_column("live_interactions", "started_at")
    op.drop_column("live_interactions", "escape_config_json")
    op.drop_column("live_interactions", "teacherbot_id")
    op.drop_column("live_interactions", "interaction_type")
