"""Add live interaction tables

Revision ID: 037_live_interaction
Revises: 036_canvas_write_perm
Create Date: 2026-05-18
"""

from alembic import op

revision = '037_live_interaction'
down_revision = '036_canvas_write_perm'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE IF NOT EXISTS live_interactions (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
            created_by UUID NOT NULL REFERENCES users(id),
            title VARCHAR NOT NULL,
            slides_json JSONB NOT NULL DEFAULT '[]',
            status VARCHAR NOT NULL DEFAULT 'DRAFT',
            current_slide_index INTEGER NOT NULL DEFAULT 0,
            current_slide_started_at TIMESTAMPTZ,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS ix_live_interactions_session_id ON live_interactions(session_id)")

    op.execute("""
        CREATE TABLE IF NOT EXISTS live_interaction_responses (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            live_interaction_id UUID NOT NULL REFERENCES live_interactions(id) ON DELETE CASCADE,
            slide_index INTEGER NOT NULL,
            student_id UUID NOT NULL REFERENCES session_students(id) ON DELETE CASCADE,
            response_json JSONB NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            CONSTRAINT uq_live_response UNIQUE (live_interaction_id, slide_index, student_id)
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS ix_live_interaction_responses_li_id ON live_interaction_responses(live_interaction_id)")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS live_interaction_responses")
    op.execute("DROP TABLE IF EXISTS live_interactions")
