"""add notebooks table

Revision ID: 022_add_notebooks
Revises: 021_add_teacherbot_kb
Create Date: 2026-03-26
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID, JSONB

revision = '022_add_notebooks'
down_revision = '021_add_teacherbot_kb'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'notebooks',
        sa.Column('id', UUID(as_uuid=True), primary_key=True, server_default=sa.text('gen_random_uuid()')),
        sa.Column('tenant_id', UUID(as_uuid=True), sa.ForeignKey('tenants.id', ondelete='CASCADE'), nullable=False),
        sa.Column('owner_id', UUID(as_uuid=True), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
        sa.Column('title', sa.String(255), nullable=False, server_default='Nuovo Notebook'),
        sa.Column('cells', JSONB, nullable=False, server_default='[]'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    )
    op.create_index('ix_notebooks_tenant_id', 'notebooks', ['tenant_id'])
    op.create_index('ix_notebooks_owner_id', 'notebooks', ['owner_id'])


def downgrade():
    op.drop_index('ix_notebooks_owner_id', table_name='notebooks')
    op.drop_index('ix_notebooks_tenant_id', table_name='notebooks')
    op.drop_table('notebooks')
