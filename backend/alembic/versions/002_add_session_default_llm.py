"""Add default LLM fields to sessions

Revision ID: 002_add_session_default_llm
Revises: 001_add_activation_tokens
Create Date: 2024-01-16

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '002_add_session_default_llm'
down_revision = '001_activation_tokens'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('sessions', sa.Column('default_llm_provider', sa.String(), nullable=True))
    op.add_column('sessions', sa.Column('default_llm_model', sa.String(), nullable=True))


def downgrade() -> None:
    op.drop_column('sessions', 'default_llm_model')
    op.drop_column('sessions', 'default_llm_provider')
