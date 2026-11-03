"""Per-section model menus: which catalogue models each section (Vibe Lab, 3D, Notebook, …) may offer.

Seeded with the models those sections hard-coded until now, so nothing changes for users after the deploy.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "114_ai_model_scopes"
down_revision = "113_live_slide_timings"
branch_labels = None
depends_on = None

SEED = {
    "vibelab": [("anthropic", "claude-sonnet-4-6"), ("anthropic", "claude-haiku-4-5-20251001"), ("anthropic", "claude-haiku-5-5"),
                ("openai", "gpt-5.6-luna"), ("deepseek", "deepseek-v4-pro")],
    "vibelab_students": [("anthropic", "claude-haiku-5-5"), ("deepseek", "deepseek-v4-pro")],
    "models3d": [("anthropic", "claude-sonnet-4-6"), ("anthropic", "claude-opus-4-8"), ("openai", "gpt-5.2"), ("openai", "gpt-5.6-luna")],
    "models3d_students": [("anthropic", "claude-sonnet-4-6"), ("openai", "gpt-5.2"), ("openai", "gpt-5.6-luna")],
    "notebook": [("deepseek", "deepseek-v4-pro"), ("anthropic", "claude-haiku-4-5-20251001")],
    "canvas": [("anthropic", "claude-sonnet-5-5")],
    "documents": [("anthropic", "claude-sonnet-5-5")],
    "agentic": [("anthropic", "claude-haiku-4-5-20251001"), ("openai", "gpt-5.6-luna")],
}


def upgrade():
    op.add_column("ai_models", sa.Column("scopes", postgresql.JSONB(), nullable=False, server_default=sa.text("'[]'::jsonb")))
    bind = op.get_bind()
    for scope, pairs in SEED.items():
        for provider, model_id in pairs:
            bind.execute(sa.text(
                "UPDATE ai_models SET scopes = scopes || to_jsonb(CAST(:scope AS text)) "
                "WHERE provider = :provider AND model_id = :model_id AND NOT scopes ? :scope"
            ), {"scope": scope, "provider": provider, "model_id": model_id})


def downgrade():
    op.drop_column("ai_models", "scopes")
