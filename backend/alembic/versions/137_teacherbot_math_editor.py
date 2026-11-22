"""Teacherbot: optional math (formula) editor for students."""
import sqlalchemy as sa
from alembic import op

revision = "137_teacherbot_math_editor"
down_revision = "136_coding_project_thumbnail"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("teacherbots", sa.Column("enable_math_editor", sa.Boolean(), nullable=False, server_default=sa.false()))


def downgrade():
    op.drop_column("teacherbots", "enable_math_editor")
