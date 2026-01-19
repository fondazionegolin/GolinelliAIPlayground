"""Add activation_tokens table

Revision ID: 001_activation_tokens
Revises: 
Create Date: 2026-01-15

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = '001_activation_tokens'
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'activation_tokens',
        sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('user_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('token', sa.String(64), nullable=False),
        sa.Column('temporary_password', sa.String(), nullable=False),
        sa.Column('is_used', sa.Boolean(), nullable=False, default=False),
        sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('used_at', sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_activation_tokens_token', 'activation_tokens', ['token'], unique=True)
    op.create_index('ix_activation_tokens_user_id', 'activation_tokens', ['user_id'])


def downgrade() -> None:
    op.drop_index('ix_activation_tokens_user_id', table_name='activation_tokens')
    op.drop_index('ix_activation_tokens_token', table_name='activation_tokens')
    op.drop_table('activation_tokens')
