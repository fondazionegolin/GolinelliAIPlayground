"""add prompt customization tables

Revision ID: 020
Revises: 019
Create Date: 2026-03-25
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = '020_add_prompt_customization'
down_revision = '019_add_feedback_reports'
branch_labels = None
depends_on = None


def upgrade():
    # Add support_chat_system_prompt to users table
    op.add_column('users', sa.Column('support_chat_system_prompt', sa.Text, nullable=True))

    # Create session_profile_overrides table
    op.create_table(
        'session_profile_overrides',
        sa.Column('id', UUID(as_uuid=True), primary_key=True, server_default=sa.text('gen_random_uuid()')),
        sa.Column('tenant_id', UUID(as_uuid=True), sa.ForeignKey('tenants.id'), nullable=False),
        sa.Column('session_id', UUID(as_uuid=True), sa.ForeignKey('sessions.id'), nullable=False),
        sa.Column('profile_key', sa.String(64), nullable=False),
        sa.Column('custom_system_prompt', sa.Text, nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    )
    op.create_index('ix_session_profile_overrides_session_id', 'session_profile_overrides', ['session_id'])
    op.create_index('ix_session_profile_overrides_tenant_id', 'session_profile_overrides', ['tenant_id'])
    op.create_unique_constraint(
        'uq_session_profile_override', 'session_profile_overrides', ['session_id', 'profile_key']
    )


def downgrade():
    op.drop_table('session_profile_overrides')
    op.drop_column('users', 'support_chat_system_prompt')
