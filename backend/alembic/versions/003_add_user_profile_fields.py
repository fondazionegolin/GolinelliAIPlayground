"""Add user profile fields (institution, avatar_url)

Revision ID: 003_add_user_profile_fields
Revises: 002_add_session_default_llm
Create Date: 2026-01-19

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '003_add_user_profile_fields'
down_revision = '002_add_session_default_llm'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('users', sa.Column('institution', sa.String(), nullable=True))
    op.add_column('users', sa.Column('avatar_url', sa.Text(), nullable=True))


def downgrade():
    op.drop_column('users', 'avatar_url')
    op.drop_column('users', 'institution')
