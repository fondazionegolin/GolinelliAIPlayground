"""coding project data (backend-persisted key-value store for generated apps)

Revision ID: 052_coding_project_data
Revises: 051_chat_collaboration
Create Date: 2026-07-01 09:00:00.000000
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "052_coding_project_data"
down_revision = "051_chat_collaboration"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'coding_project_data',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text('gen_random_uuid()')),
        sa.Column('project_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('coding_projects.id', ondelete='CASCADE'), nullable=False),
        sa.Column('key', sa.String(length=200), nullable=False),
        sa.Column('value_json', postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default='{}'),
        sa.Column('size_bytes', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index('ix_coding_project_data_project_id', 'coding_project_data', ['project_id'])
    op.create_unique_constraint(
        'uq_coding_project_data_project_key', 'coding_project_data', ['project_id', 'key']
    )


def downgrade() -> None:
    op.drop_constraint('uq_coding_project_data_project_key', 'coding_project_data', type_='unique')
    op.drop_index('ix_coding_project_data_project_id', table_name='coding_project_data')
    op.drop_table('coding_project_data')
