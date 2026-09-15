"""add Turing lobby settings

Revision ID: 069_turing_lobby_settings
Revises: 068_turing_test
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "069_turing_lobby_settings"
down_revision = "068_turing_test"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("turing_experiments", sa.Column("temperature", sa.Float(), nullable=False, server_default="0.7"))
    op.add_column("turing_experiments", sa.Column("confidence_style", sa.Integer(), nullable=False, server_default="3"))
    op.add_column("turing_experiments", sa.Column("response_length", sa.Integer(), nullable=False, server_default="2"))
    op.add_column("turing_experiments", sa.Column("emoji_usage", sa.Integer(), nullable=False, server_default="1"))
    op.create_table(
        "turing_teacher_settings",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("teacher_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("persona_prompt", sa.Text(), nullable=False),
        sa.Column("temperature", sa.Float(), nullable=False, server_default="0.7"),
        sa.Column("confidence_style", sa.Integer(), nullable=False, server_default="3"),
        sa.Column("response_length", sa.Integer(), nullable=False, server_default="2"),
        sa.Column("emoji_usage", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("teacher_id", name="uq_turing_teacher_settings_teacher_id"),
        sa.CheckConstraint("temperature >= 0 AND temperature <= 1.2", name="ck_turing_teacher_settings_turing_settings_temperature"),
        sa.CheckConstraint("confidence_style >= 1 AND confidence_style <= 5", name="ck_turing_teacher_settings_turing_settings_confidence"),
        sa.CheckConstraint("response_length >= 1 AND response_length <= 5", name="ck_turing_teacher_settings_turing_settings_length"),
        sa.CheckConstraint("emoji_usage >= 0 AND emoji_usage <= 3", name="ck_turing_teacher_settings_turing_settings_emoji"),
    )
    op.create_index("ix_turing_teacher_settings_tenant_id", "turing_teacher_settings", ["tenant_id"])
    op.create_index("ix_turing_teacher_settings_teacher_id", "turing_teacher_settings", ["teacher_id"], unique=True)


def downgrade():
    op.drop_table("turing_teacher_settings")
    op.drop_column("turing_experiments", "emoji_usage")
    op.drop_column("turing_experiments", "response_length")
    op.drop_column("turing_experiments", "confidence_style")
    op.drop_column("turing_experiments", "temperature")
