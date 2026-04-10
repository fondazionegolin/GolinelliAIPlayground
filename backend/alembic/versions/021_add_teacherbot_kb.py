"""add teacherbot knowledge base

Revision ID: 021
Revises: 020
Create Date: 2026-03-26
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = '021_add_teacherbot_kb'
down_revision = '020_add_prompt_customization'
branch_labels = None
depends_on = None


def upgrade():
    # Add teacherbot_id to rag_documents (nullable — KB docs have no file_id)
    op.add_column('rag_documents',
        sa.Column('teacherbot_id', UUID(as_uuid=True),
                  sa.ForeignKey('teacherbots.id', ondelete='CASCADE'),
                  nullable=True))
    op.create_index('ix_rag_documents_teacherbot_id', 'rag_documents', ['teacherbot_id'])

    # Make file_id nullable so KB-only documents don't require a file record
    op.alter_column('rag_documents', 'file_id', nullable=True)


def downgrade():
    op.alter_column('rag_documents', 'file_id', nullable=False)
    op.drop_index('ix_rag_documents_teacherbot_id', 'rag_documents')
    op.drop_column('rag_documents', 'teacherbot_id')
