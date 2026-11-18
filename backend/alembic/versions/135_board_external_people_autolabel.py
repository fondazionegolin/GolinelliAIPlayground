"""Boards: people without a platform account (external assignees) and automatic task labelling."""
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql
from alembic import op

revision = "135_board_external_people"
down_revision = "134_presentation_styles"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("boards", sa.Column("external_people_json", postgresql.JSONB(), nullable=False, server_default="[]"))
    op.add_column("boards", sa.Column("auto_label", sa.Boolean(), nullable=False, server_default=sa.false()))


def downgrade():
    op.drop_column("boards", "auto_label")
    op.drop_column("boards", "external_people_json")
