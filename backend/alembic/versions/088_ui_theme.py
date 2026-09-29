"""Per-user light/dark UI theme preference (teachers + session students)

Revision ID: 088_ui_theme
Revises: 087_session_module_ai_3d
"""

from alembic import op
import sqlalchemy as sa


revision = "088_ui_theme"
down_revision = "087_session_module_ai_3d"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("users", sa.Column("ui_theme", sa.String(16), nullable=True))
    op.add_column("session_students", sa.Column("ui_theme", sa.String(16), nullable=True))


def downgrade():
    op.drop_column("session_students", "ui_theme")
    op.drop_column("users", "ui_theme")
