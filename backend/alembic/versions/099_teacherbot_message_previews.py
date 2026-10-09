"""Persist attachment previews in teacherbot messages.

Revision ID: 099_teacherbot_message_previews
Revises: 098_ml_image_projects
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "099_teacherbot_message_previews"
down_revision = "098_ml_image_projects"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("teacherbot_messages", sa.Column("attachments_json", postgresql.JSONB(), nullable=True))


def downgrade():
    op.drop_column("teacherbot_messages", "attachments_json")
