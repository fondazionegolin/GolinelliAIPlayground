"""Admin LLM model catalogue and scan log.

Revision ID: 095_ai_models
Revises: 094_board_weekly_sprints
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "095_ai_models"
down_revision = "094_board_weekly_sprints"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "ai_models",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("provider", sa.String(20), nullable=False, index=True),
        sa.Column("model_id", sa.String(120), nullable=False),
        sa.Column("display_name", sa.String(160), nullable=False),
        sa.Column("status", sa.String(12), nullable=False, server_default="active"),
        sa.Column("input_usd", sa.Float(), nullable=True),
        sa.Column("output_usd", sa.Float(), nullable=True),
        sa.Column("cached_input_usd", sa.Float(), nullable=True),
        sa.Column("context_window", sa.Integer(), nullable=True),
        sa.Column("quality_score", sa.Float(), nullable=True),
        sa.Column("quality_source", sa.String(200), nullable=True),
        sa.Column("pricing_url", sa.String(300), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("proposed_input_usd", sa.Float(), nullable=True),
        sa.Column("proposed_output_usd", sa.Float(), nullable=True),
        sa.Column("proposed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("price_checked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("seen_in_api", sa.Boolean(), nullable=True),
        sa.Column("acknowledged", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("first_seen_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("provider", "model_id", name="uq_ai_models_provider_model"),
    )
    op.create_table(
        "ai_model_scans",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("ran_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False, index=True),
        sa.Column("trigger", sa.String(12), nullable=False, server_default="manual"),
        sa.Column("summary_json", postgresql.JSONB(), nullable=False, server_default="{}"),
    )


def downgrade():
    op.drop_table("ai_model_scans")
    op.drop_table("ai_models")
