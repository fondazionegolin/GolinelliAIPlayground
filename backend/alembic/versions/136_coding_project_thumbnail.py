"""Vibe Lab: project preview thumbnail shown on the library cards."""
import sqlalchemy as sa
from alembic import op

revision = "136_coding_project_thumbnail"
down_revision = "135_board_external_people"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("coding_projects", sa.Column("thumbnail", sa.Text(), nullable=True))


def downgrade():
    op.drop_column("coding_projects", "thumbnail")
