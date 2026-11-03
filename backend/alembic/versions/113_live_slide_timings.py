"""Live interactions: when each slide went live, to compute students' response times."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "113_live_slide_timings"
down_revision = "112_legal_document_files"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("live_interactions", sa.Column("slide_timings", postgresql.JSONB(), nullable=True))


def downgrade():
    op.drop_column("live_interactions", "slide_timings")
