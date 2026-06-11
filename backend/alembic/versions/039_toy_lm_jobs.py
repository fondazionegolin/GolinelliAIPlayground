"""Add toy_lm_jobs table

Revision ID: 039_toy_lm_jobs
Revises: 038_school_tenants
Create Date: 2026-06-11
"""

from alembic import op

revision = '039_toy_lm_jobs'
down_revision = '038_school_tenants'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE IF NOT EXISTS toy_lm_jobs (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            teacher_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            tenant_id UUID NOT NULL,
            name VARCHAR NOT NULL DEFAULT 'Modello senza nome',
            status VARCHAR NOT NULL DEFAULT 'draft',
            corpus_text TEXT,
            corpus_char_count INTEGER DEFAULT 0,
            hyperparams_json JSONB NOT NULL DEFAULT '{}',
            vocab_json JSONB,
            metrics_json JSONB NOT NULL DEFAULT '[]',
            saved_epoch INTEGER DEFAULT 0,
            param_count INTEGER DEFAULT 0,
            checkpoint_path VARCHAR,
            error_message TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            started_at TIMESTAMPTZ,
            completed_at TIMESTAMPTZ
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS ix_toy_lm_jobs_teacher_id ON toy_lm_jobs(teacher_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_toy_lm_jobs_tenant_id ON toy_lm_jobs(tenant_id)")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS toy_lm_jobs")
