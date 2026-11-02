"""Smart canvases: a small preview image shown on the landing page."""
from alembic import op
import sqlalchemy as sa

revision = "111_smart_canvas_preview"
down_revision = "110_smart_canvas_sharing"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("smart_canvases", sa.Column("preview", sa.Text(), nullable=True))


def downgrade():
    op.drop_column("smart_canvases", "preview")
