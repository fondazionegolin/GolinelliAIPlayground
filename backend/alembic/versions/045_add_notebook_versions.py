"""Add notebook version history (snapshots / rollback)

Revision ID: 045_add_notebook_versions
Revises: 044_add_rag_project_id
Create Date: 2026-06-29
"""

from alembic import op

revision = "045_add_notebook_versions"
down_revision = "044_add_rag_project_id"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE IF NOT EXISTS notebook_versions (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            notebook_id UUID NOT NULL REFERENCES notebooks(id) ON DELETE CASCADE,
            tenant_id UUID NOT NULL,
            label VARCHAR(160) NOT NULL DEFAULT 'Snapshot',
            source VARCHAR(32) NOT NULL DEFAULT 'manual',
            title VARCHAR(255) NOT NULL DEFAULT 'Nuovo Notebook',
            project_type VARCHAR(32) NOT NULL DEFAULT 'python',
            cells JSONB NOT NULL DEFAULT '[]'::jsonb,
            editor_settings JSONB NOT NULL DEFAULT '{}'::jsonb,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS ix_notebook_versions_notebook_id ON notebook_versions(notebook_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_notebook_versions_tenant_id ON notebook_versions(tenant_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_notebook_versions_notebook_created ON notebook_versions(notebook_id, created_at DESC)")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS notebook_versions")
