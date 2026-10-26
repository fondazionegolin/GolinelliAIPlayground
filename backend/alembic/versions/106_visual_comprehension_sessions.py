"""Persist private visual comprehension conversations and their source images."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "106_visual_sessions"
down_revision = "105_video_projects"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "visual_comprehension_sessions",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("owner_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("title", sa.String(200), nullable=False),
        sa.Column("image_key", sa.String(300), nullable=False),
        sa.Column("image_name", sa.String(250), nullable=False),
        sa.Column("image_width", sa.Integer(), nullable=False),
        sa.Column("image_height", sa.Integer(), nullable=False),
        sa.Column("inventory", postgresql.JSONB(), nullable=True),
        sa.Column("dialogue", postgresql.JSONB(), nullable=False, server_default="{}"),
        sa.Column("messages", postgresql.JSONB(), nullable=False, server_default="[]"),
        sa.Column("draft", sa.Text(), nullable=False, server_default=""),
        sa.Column("revision", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("active_request_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("request_started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_visual_sessions_owner_updated", "visual_comprehension_sessions", ["owner_id", "updated_at"])


def downgrade():
    op.drop_index("ix_visual_sessions_owner_updated", table_name="visual_comprehension_sessions")
    op.drop_table("visual_comprehension_sessions")
