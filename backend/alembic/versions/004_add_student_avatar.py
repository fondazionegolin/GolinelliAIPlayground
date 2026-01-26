"""add student avatar

Revision ID: 004_add_student_avatar
Revises: 003_add_user_profile_fields
Create Date: 2026-01-22 11:15:00

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '004_add_student_avatar'
down_revision = '003_add_user_profile_fields'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add avatar_url column to session_students table
    op.add_column('session_students', sa.Column('avatar_url', sa.Text(), nullable=True))


def downgrade() -> None:
    # Remove avatar_url column
    op.drop_column('session_students', 'avatar_url')
