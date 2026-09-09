"""Add legal document acceptances

Revision ID: 043_legal_acceptances
Revises: 042_add_coding_design_systems
Create Date: 2026-06-25
"""

from alembic import op

revision = "043_legal_acceptances"
down_revision = "042_add_coding_design_systems"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE IF NOT EXISTS legal_document_acceptances (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL,
            user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            document_key VARCHAR(64) NOT NULL,
            document_title VARCHAR(180) NOT NULL,
            document_version VARCHAR(64) NOT NULL,
            accepted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            ip_address VARCHAR(64),
            user_agent TEXT,
            CONSTRAINT uq_legal_acceptance_user_doc_version UNIQUE (user_id, document_key, document_version)
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS ix_legal_document_acceptances_tenant_id ON legal_document_acceptances(tenant_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_legal_document_acceptances_user_id ON legal_document_acceptances(user_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_legal_document_acceptances_document_key ON legal_document_acceptances(document_key)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_legal_document_acceptances_accepted_at ON legal_document_acceptances(accepted_at)")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS legal_document_acceptances")
