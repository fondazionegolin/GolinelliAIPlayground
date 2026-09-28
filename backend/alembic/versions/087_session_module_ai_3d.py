"""Session modules: separate "AI 3D" (Meshy) toggle from the solid-modeler 3D Lab

Sessions that already had the 3D Lab on keep generative AI 3D available too.

Revision ID: 087_session_module_ai_3d
Revises: 086_background_jobs
"""

from alembic import op


revision = "087_session_module_ai_3d"
down_revision = "086_background_jobs"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("""
        INSERT INTO session_modules (id, tenant_id, session_id, module_key, is_enabled, config_json, updated_at)
        SELECT gen_random_uuid(), m.tenant_id, m.session_id, 'models3d_ai', true, '{}'::jsonb, now()
        FROM session_modules m
        WHERE m.module_key = 'models3d' AND m.is_enabled = true
          AND NOT EXISTS (
            SELECT 1 FROM session_modules x WHERE x.session_id = m.session_id AND x.module_key = 'models3d_ai'
          )
    """)


def downgrade():
    op.execute("DELETE FROM session_modules WHERE module_key = 'models3d_ai'")
