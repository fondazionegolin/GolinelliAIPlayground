"""Add project id to RAG documents

Revision ID: 044_add_rag_project_id
Revises: 043_legal_acceptances
Create Date: 2026-06-28
"""

from alembic import op


revision = "044_add_rag_project_id"
down_revision = "043_legal_acceptances"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE rag_documents ADD COLUMN IF NOT EXISTS project_id VARCHAR(128)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_rag_documents_project_id ON rag_documents(project_id)")


def downgrade() -> None:
    op.drop_index("ix_rag_documents_project_id", table_name="rag_documents")
    op.drop_column("rag_documents", "project_id")
