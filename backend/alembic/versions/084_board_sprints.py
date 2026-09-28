"""Boards: sprints (board.sprints_json, card.sprint_id)

Revision ID: 084_board_sprints
Revises: 083_board_backlog_sharing
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "084_board_sprints"
down_revision = "083_board_backlog_sharing"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("boards", sa.Column("sprints_json", postgresql.JSONB(), nullable=False, server_default="[]"))
    op.add_column("board_cards", sa.Column("sprint_id", sa.String(48), nullable=True))


def downgrade():
    op.drop_column("board_cards", "sprint_id")
    op.drop_column("boards", "sprints_json")
