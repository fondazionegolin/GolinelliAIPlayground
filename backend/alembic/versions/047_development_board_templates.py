"""Extend feedback board with manual tasks and configurable columns

Revision ID: 047_development_board_templates
Revises: 046_add_feedback_board
Create Date: 2026-06-30
"""

from alembic import op

revision = "047_development_board_templates"
down_revision = "046_add_feedback_board"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE feedback_reports ADD COLUMN IF NOT EXISTS source VARCHAR(20) NOT NULL DEFAULT 'feedback'")
    op.execute("ALTER TABLE feedback_reports ADD COLUMN IF NOT EXISTS created_by_display_name VARCHAR(256)")
    op.execute("ALTER TABLE feedback_reports ADD COLUMN IF NOT EXISTS last_actor_display_name VARCHAR(256)")

    op.execute("""
        CREATE TABLE IF NOT EXISTS feedback_board_configs (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            scope VARCHAR(64) NOT NULL UNIQUE DEFAULT 'global',
            title VARCHAR(160) NOT NULL DEFAULT 'Board sviluppo',
            columns_json JSONB NOT NULL DEFAULT '[]'::jsonb,
            is_shared_with_class BOOLEAN NOT NULL DEFAULT false,
            students_can_contribute BOOLEAN NOT NULL DEFAULT false,
            updated_by_id UUID REFERENCES users(id),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS ix_feedback_board_configs_scope ON feedback_board_configs(scope)")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS feedback_board_configs")
    op.execute("ALTER TABLE feedback_reports DROP COLUMN IF EXISTS last_actor_display_name")
    op.execute("ALTER TABLE feedback_reports DROP COLUMN IF EXISTS created_by_display_name")
    op.execute("ALTER TABLE feedback_reports DROP COLUMN IF EXISTS source")
