"""add saved Turing personas and experiment identity

Revision ID: 071_turing_personas
Revises: 070_turing_lobby_defaults
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql


revision = "071_turing_personas"
down_revision = "070_turing_lobby_defaults"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "turing_personas",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("teacher_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("persona_prompt", sa.Text(), nullable=False),
        sa.Column("avatar_url", sa.Text(), nullable=True),
        sa.Column("temperature", sa.Float(), nullable=False, server_default="0.7"),
        sa.Column("confidence_style", sa.Integer(), nullable=False, server_default="3"),
        sa.Column("response_length", sa.Integer(), nullable=False, server_default="2"),
        sa.Column("emoji_usage", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.CheckConstraint("temperature >= 0 AND temperature <= 1.2", name="ck_turing_personas_turing_persona_temperature"),
        sa.CheckConstraint("confidence_style >= 1 AND confidence_style <= 5", name="ck_turing_personas_turing_persona_confidence"),
        sa.CheckConstraint("response_length >= 1 AND response_length <= 5", name="ck_turing_personas_turing_persona_length"),
        sa.CheckConstraint("emoji_usage >= 0 AND emoji_usage <= 3", name="ck_turing_personas_turing_persona_emoji"),
    )
    op.create_index("ix_turing_personas_tenant_id", "turing_personas", ["tenant_id"])
    op.create_index("ix_turing_personas_teacher_id", "turing_personas", ["teacher_id"])
    op.create_index("ix_turing_personas_teacher_updated", "turing_personas", ["teacher_id", "updated_at"])
    op.add_column("turing_experiments", sa.Column("persona_id", postgresql.UUID(as_uuid=True), nullable=True))
    op.add_column("turing_experiments", sa.Column("persona_name", sa.String(120), nullable=False, server_default="Interlocutore misterioso"))
    op.add_column("turing_experiments", sa.Column("avatar_url", sa.Text(), nullable=True))
    op.create_foreign_key("fk_turing_experiments_persona_id", "turing_experiments", "turing_personas", ["persona_id"], ["id"], ondelete="SET NULL")
    op.create_index("ix_turing_experiments_persona_id", "turing_experiments", ["persona_id"])


def downgrade():
    op.drop_index("ix_turing_experiments_persona_id", table_name="turing_experiments")
    op.drop_constraint("fk_turing_experiments_persona_id", "turing_experiments", type_="foreignkey")
    op.drop_column("turing_experiments", "avatar_url")
    op.drop_column("turing_experiments", "persona_name")
    op.drop_column("turing_experiments", "persona_id")
    op.drop_table("turing_personas")
