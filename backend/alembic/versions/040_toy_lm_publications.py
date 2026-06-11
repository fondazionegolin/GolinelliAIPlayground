"""Add toy_lm_job_publications table

Revision ID: 040_toy_lm_publications
Revises: 039_toy_lm_jobs
Create Date: 2026-06-11
"""

from alembic import op

revision = '040_toy_lm_publications'
down_revision = '039_toy_lm_jobs'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE IF NOT EXISTS toy_lm_job_publications (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            job_id UUID NOT NULL REFERENCES toy_lm_jobs(id) ON DELETE CASCADE,
            session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
            tenant_id UUID NOT NULL,
            teacher_id UUID NOT NULL REFERENCES users(id),
            chat_message_id UUID REFERENCES chat_messages(id) ON DELETE SET NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            CONSTRAINT uq_toy_lm_publication_job_session UNIQUE (job_id, session_id)
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS ix_toy_lm_job_publications_job_id ON toy_lm_job_publications(job_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_toy_lm_job_publications_session_id ON toy_lm_job_publications(session_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_toy_lm_job_publications_tenant_id ON toy_lm_job_publications(tenant_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_toy_lm_job_publications_teacher_id ON toy_lm_job_publications(teacher_id)")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS toy_lm_job_publications")
