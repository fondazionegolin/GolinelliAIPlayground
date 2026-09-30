"""Inquiry: multiple suspects (per-suspect trust/pressure, accusation)

Revision ID: 090_inquiry_suspects
Revises: 089_teacherbot_inquiry
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "090_inquiry_suspects"
down_revision = "089_teacherbot_inquiry"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("inquiry_sessions", sa.Column("suspect_state", postgresql.JSONB(), nullable=False, server_default="{}"))
    op.add_column("inquiry_sessions", sa.Column("accused_suspect_id", sa.String(40), nullable=True))


def downgrade():
    op.drop_column("inquiry_sessions", "accused_suspect_id")
    op.drop_column("inquiry_sessions", "suspect_state")
