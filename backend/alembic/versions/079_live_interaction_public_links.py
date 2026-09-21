"""add public links to live interactions

Revision ID: 079_live_public_links
Revises: 078_live_escape_rooms
"""

from alembic import op
import sqlalchemy as sa


revision = "079_live_public_links"
down_revision = "078_live_escape_rooms"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("live_interactions", sa.Column("public_token", sa.String(length=64), nullable=True))
    op.add_column("live_interactions", sa.Column("public_enabled", sa.Boolean(), nullable=False, server_default=sa.false()))
    op.create_index("ix_live_interactions_public_token", "live_interactions", ["public_token"], unique=True)


def downgrade():
    op.drop_index("ix_live_interactions_public_token", table_name="live_interactions")
    op.drop_column("live_interactions", "public_enabled")
    op.drop_column("live_interactions", "public_token")
