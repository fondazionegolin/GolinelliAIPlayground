"""teacherbot live voice flag

Revision ID: 050_teacherbot_live_voice
Revises: 049_board_coding_metadata
Create Date: 2026-06-30 16:00:00.000000
"""
from alembic import op
import sqlalchemy as sa


revision = "050_teacherbot_live_voice"
down_revision = "049_board_coding_metadata"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "teacherbots",
        sa.Column("enable_live_voice", sa.Boolean(), nullable=False, server_default=sa.false()),
    )


def downgrade() -> None:
    op.drop_column("teacherbots", "enable_live_voice")
