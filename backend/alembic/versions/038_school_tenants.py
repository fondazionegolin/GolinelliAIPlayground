"""School tenants: TenantType, structural limits, STUDENT_POOL credit level, is_school_owner

Revision ID: 038_school_tenants
Revises: 037_live_interaction
Create Date: 2026-05-25
"""

from alembic import op
import sqlalchemy as sa

revision = '038_school_tenants'
down_revision = '037_live_interaction'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ── Tenants: new columns ─────────────────────────────────────────────────
    op.execute("""
        ALTER TABLE tenants
            ADD COLUMN IF NOT EXISTS tenant_type VARCHAR(20) NOT NULL DEFAULT 'INDIVIDUAL',
            ADD COLUMN IF NOT EXISTS owner_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
            ADD COLUMN IF NOT EXISTS max_teachers INTEGER NOT NULL DEFAULT 5,
            ADD COLUMN IF NOT EXISTS max_students_per_teacher INTEGER NOT NULL DEFAULT 100,
            ADD COLUMN IF NOT EXISTS max_students_per_class INTEGER NOT NULL DEFAULT 30,
            ADD COLUMN IF NOT EXISTS monthly_credit_pool FLOAT NOT NULL DEFAULT 10.0,
            ADD COLUMN IF NOT EXISTS teacher_monthly_cap FLOAT NOT NULL DEFAULT 3.0
    """)

    # ── Users: is_school_owner ────────────────────────────────────────────────
    op.execute("""
        ALTER TABLE users
            ADD COLUMN IF NOT EXISTS is_school_owner BOOLEAN NOT NULL DEFAULT FALSE
    """)

    # ── credit_limits: extend level enum to include STUDENT_POOL ─────────────
    # The level column uses native_enum=False (stored as VARCHAR), so just update
    # the CHECK constraint if it exists, or add the new value.
    # Since it's stored as VARCHAR with no DB-level enum, no DDL change needed.
    # We simply document this here for clarity.

    # ── Backfill: mark existing tenants as INDIVIDUAL ─────────────────────────
    op.execute("UPDATE tenants SET tenant_type = 'INDIVIDUAL' WHERE tenant_type IS NULL OR tenant_type = ''")


def downgrade() -> None:
    op.execute("""
        ALTER TABLE tenants
            DROP COLUMN IF EXISTS tenant_type,
            DROP COLUMN IF EXISTS owner_user_id,
            DROP COLUMN IF EXISTS max_teachers,
            DROP COLUMN IF EXISTS max_students_per_teacher,
            DROP COLUMN IF EXISTS max_students_per_class,
            DROP COLUMN IF EXISTS monthly_credit_pool,
            DROP COLUMN IF EXISTS teacher_monthly_cap
    """)
    op.execute("ALTER TABLE users DROP COLUMN IF EXISTS is_school_owner")
