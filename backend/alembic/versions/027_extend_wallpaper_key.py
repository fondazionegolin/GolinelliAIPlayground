"""extend wallpaper_key to Text for custom image URLs

Revision ID: 027_extend_wallpaper_key
Revises: 026_add_desktop
Create Date: 2026-03-29
"""
from alembic import op
import sqlalchemy as sa

revision = '027_extend_wallpaper_key'
down_revision = '026_add_desktop'
branch_labels = None
depends_on = None


def upgrade():
    op.alter_column('user_desktops', 'wallpaper_key',
                    existing_type=sa.String(200),
                    type_=sa.Text,
                    existing_nullable=False)


def downgrade():
    op.alter_column('user_desktops', 'wallpaper_key',
                    existing_type=sa.Text,
                    type_=sa.String(200),
                    existing_nullable=False)
