"""Video Studio projects (admin testing).

Revision ID: 105_video_projects
Revises: 104_credit_bundles_alerts
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "105_video_projects"
down_revision = "104_credit_bundles_alerts"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "video_projects",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("owner_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("title", sa.String(200), nullable=False),
        sa.Column("source_text", sa.Text(), nullable=False, server_default=""),
        sa.Column("brief", sa.Text(), nullable=True),
        sa.Column("style_key", sa.String(40), nullable=False, server_default="flat_2d"),
        sa.Column("aspect", sa.String(8), nullable=False, server_default="16:9"),
        sa.Column("language", sa.String(8), nullable=False, server_default="it"),
        sa.Column("target_shots", sa.Float(), nullable=False, server_default="6"),
        sa.Column("status", sa.String(20), nullable=False, server_default="draft"),
        sa.Column("phase_label", sa.String(160), nullable=True),
        sa.Column("script", postgresql.JSONB(), nullable=False, server_default="{}"),
        sa.Column("final_key", sa.String(256), nullable=True),
        sa.Column("cost_usd", sa.Float(), nullable=False, server_default="0"),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_video_projects_owner_id", "video_projects", ["owner_id"])


def downgrade():
    op.drop_index("ix_video_projects_owner_id", table_name="video_projects")
    op.drop_table("video_projects")
