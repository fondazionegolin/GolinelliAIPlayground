"""Platform-wide admin settings (default student chatbots).

Revision ID: 100_platform_settings
Revises: 099_teacherbot_message_previews
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "100_platform_settings"
down_revision = "099_teacherbot_message_previews"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "platform_settings",
        sa.Column("key", sa.String(80), primary_key=True),
        sa.Column("value", postgresql.JSONB(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )


def downgrade():
    op.drop_table("platform_settings")
