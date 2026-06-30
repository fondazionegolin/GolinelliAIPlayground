"""Add feedback project-management board (kanban columns, category/urgency, collaborators)

Revision ID: 046_add_feedback_board
Revises: 045_add_notebook_versions
Create Date: 2026-06-29
"""

from alembic import op

revision = "046_add_feedback_board"
down_revision = "045_add_notebook_versions"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE feedback_reports ADD COLUMN IF NOT EXISTS board_status VARCHAR(20) NOT NULL DEFAULT 'inbox'")
    op.execute("ALTER TABLE feedback_reports ADD COLUMN IF NOT EXISTS category VARCHAR(20)")
    op.execute("ALTER TABLE feedback_reports ADD COLUMN IF NOT EXISTS urgency VARCHAR(10)")
    op.execute("ALTER TABLE feedback_reports ADD COLUMN IF NOT EXISTS internal_note TEXT")
    op.execute("ALTER TABLE feedback_reports ADD COLUMN IF NOT EXISTS auto_classified BOOLEAN NOT NULL DEFAULT false")

    op.execute("""
        CREATE TABLE IF NOT EXISTS feedback_board_collaborators (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            teacher_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
            added_by_id UUID REFERENCES users(id),
            added_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS ix_feedback_board_collaborators_teacher_id ON feedback_board_collaborators(teacher_id)")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS feedback_board_collaborators")
    op.execute("ALTER TABLE feedback_reports DROP COLUMN IF EXISTS auto_classified")
    op.execute("ALTER TABLE feedback_reports DROP COLUMN IF EXISTS internal_note")
    op.execute("ALTER TABLE feedback_reports DROP COLUMN IF EXISTS urgency")
    op.execute("ALTER TABLE feedback_reports DROP COLUMN IF EXISTS category")
    op.execute("ALTER TABLE feedback_reports DROP COLUMN IF EXISTS board_status")
