"""Model roles (per-feature model overrides) and catalogue kinds.

Revision ID: 096_ai_model_roles
Revises: 095_ai_models
"""

from alembic import op
import sqlalchemy as sa


revision = "096_ai_model_roles"
down_revision = "095_ai_models"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("ai_models", sa.Column("kind", sa.String(12), nullable=False, server_default="text"))
    op.add_column("ai_models", sa.Column("offered", sa.Boolean(), nullable=False, server_default=sa.false()))
    op.add_column("ai_models", sa.Column("price_note", sa.String(200), nullable=True))
    op.create_table(
        "ai_model_roles",
        sa.Column("role", sa.String(40), primary_key=True),
        sa.Column("provider", sa.String(20), nullable=False),
        sa.Column("model_id", sa.String(120), nullable=False),
        sa.Column("updated_by", sa.String(120), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )


def downgrade():
    op.drop_table("ai_model_roles")
    op.drop_column("ai_models", "price_note")
    op.drop_column("ai_models", "offered")
    op.drop_column("ai_models", "kind")
