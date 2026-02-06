"""add document drafts

Revision ID: 009_add_document_drafts
Revises: 008_credits_system
Create Date: 2026-02-06

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = '009_add_document_drafts'
down_revision: Union[str, None] = '008_credits_system'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'document_drafts',
        sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('tenant_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('session_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('owner_teacher_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('owner_student_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('title', sa.String(), nullable=False),
        sa.Column('doc_type', sa.String(), nullable=False),
        sa.Column('content_json', sa.Text(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['tenant_id'], ['tenants.id'], name=op.f('fk_document_drafts_tenant_id_tenants')),
        sa.ForeignKeyConstraint(['session_id'], ['sessions.id'], name=op.f('fk_document_drafts_session_id_sessions')),
        sa.ForeignKeyConstraint(['owner_teacher_id'], ['users.id'], name=op.f('fk_document_drafts_owner_teacher_id_users')),
        sa.ForeignKeyConstraint(['owner_student_id'], ['session_students.id'], name=op.f('fk_document_drafts_owner_student_id_session_students')),
        sa.PrimaryKeyConstraint('id', name=op.f('pk_document_drafts'))
    )
    op.create_index(op.f('ix_document_drafts_tenant_id'), 'document_drafts', ['tenant_id'], unique=False)
    op.create_index(op.f('ix_document_drafts_session_id'), 'document_drafts', ['session_id'], unique=False)
    op.create_index(op.f('ix_document_drafts_owner_teacher_id'), 'document_drafts', ['owner_teacher_id'], unique=False)
    op.create_index(op.f('ix_document_drafts_owner_student_id'), 'document_drafts', ['owner_student_id'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_document_drafts_owner_student_id'), table_name='document_drafts')
    op.drop_index(op.f('ix_document_drafts_owner_teacher_id'), table_name='document_drafts')
    op.drop_index(op.f('ix_document_drafts_session_id'), table_name='document_drafts')
    op.drop_index(op.f('ix_document_drafts_tenant_id'), table_name='document_drafts')
    op.drop_table('document_drafts')
