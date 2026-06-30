"""Add generic session boards

Revision ID: 048_generic_boards
Revises: 047_development_board_templates
Create Date: 2026-06-30
"""

from alembic import op

revision = "048_generic_boards"
down_revision = "047_development_board_templates"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE IF NOT EXISTS boards (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id UUID NOT NULL REFERENCES tenants(id),
            session_id UUID REFERENCES sessions(id) ON DELETE CASCADE,
            owner_user_id UUID REFERENCES users(id) ON DELETE CASCADE,
            owner_student_id UUID REFERENCES session_students(id) ON DELETE CASCADE,
            title VARCHAR(160) NOT NULL,
            description TEXT,
            template_key VARCHAR(40),
            columns_json JSONB NOT NULL DEFAULT '[]'::jsonb,
            visibility VARCHAR(20) NOT NULL DEFAULT 'private',
            students_can_edit BOOLEAN NOT NULL DEFAULT false,
            created_by_display_name VARCHAR(256),
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS ix_boards_tenant_id ON boards(tenant_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_boards_session_id ON boards(session_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_boards_owner_user_id ON boards(owner_user_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_boards_owner_student_id ON boards(owner_student_id)")

    op.execute("""
        CREATE TABLE IF NOT EXISTS board_cards (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            board_id UUID NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
            column_id VARCHAR(64) NOT NULL,
            title VARCHAR(220) NOT NULL,
            description TEXT,
            created_by_display_name VARCHAR(256),
            last_actor_display_name VARCHAR(256),
            sort_order VARCHAR(32),
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS ix_board_cards_board_id ON board_cards(board_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_board_cards_column_id ON board_cards(column_id)")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS board_cards")
    op.execute("DROP TABLE IF EXISTS boards")
