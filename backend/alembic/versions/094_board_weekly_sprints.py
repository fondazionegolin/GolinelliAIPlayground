"""Optional weekly sprint schedule for boards.

Revision ID: 094_board_weekly_sprints
Revises: 093_teacher_drive
"""

from alembic import op
import sqlalchemy as sa


revision = "094_board_weekly_sprints"
down_revision = "093_teacher_drive"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("boards", sa.Column("auto_sprint_weekly", sa.Boolean(), nullable=False, server_default=sa.false()))


def downgrade():
    op.drop_column("boards", "auto_sprint_weekly")
