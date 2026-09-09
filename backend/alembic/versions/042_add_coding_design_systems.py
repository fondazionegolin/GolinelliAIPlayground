"""Add reusable coding design systems library

Revision ID: 042_add_coding_design_systems
Revises: 041_add_student_coding_lab
Create Date: 2026-06-22
"""

from alembic import op

revision = "042_add_coding_design_systems"
down_revision = "041_add_student_coding_lab"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE IF NOT EXISTS coding_design_systems (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
            session_id UUID REFERENCES sessions(id) ON DELETE SET NULL,
            owner_student_id UUID REFERENCES session_students(id) ON DELETE SET NULL,
            owner_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
            name VARCHAR(160) NOT NULL,
            description TEXT,
            tokens_json JSONB NOT NULL DEFAULT '{}'::jsonb,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS ix_coding_design_systems_tenant_id ON coding_design_systems(tenant_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_coding_design_systems_session_id ON coding_design_systems(session_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_coding_design_systems_owner_student_id ON coding_design_systems(owner_student_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_coding_design_systems_owner_user_id ON coding_design_systems(owner_user_id)")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS coding_design_systems")
