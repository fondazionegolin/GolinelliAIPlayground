"""3D Lab solid modeler projects

Revision ID: 080_solid_models
Revises: 079_live_public_links
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "080_solid_models"
down_revision = "079_live_public_links"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "solid_models",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("owner_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(length=160), nullable=False),
        sa.Column("scene", postgresql.JSONB(), nullable=False),
        sa.Column("thumbnail", sa.Text(), nullable=True),
        sa.Column("shared_class_ids", postgresql.JSONB(), nullable=False, server_default="[]"),
        sa.Column("public_token", sa.String(length=64), nullable=True),
        sa.Column("public_enabled", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_solid_models_tenant_id", "solid_models", ["tenant_id"])
    op.create_index("ix_solid_models_owner_id", "solid_models", ["owner_id"])
    op.create_index("ix_solid_models_owner_updated", "solid_models", ["owner_id", "updated_at"])
    op.create_index("ix_solid_models_public_token", "solid_models", ["public_token"], unique=True)
    op.create_index("ix_solid_models_shared_class_ids", "solid_models", ["shared_class_ids"], postgresql_using="gin")


def downgrade():
    op.drop_index("ix_solid_models_shared_class_ids", table_name="solid_models")
    op.drop_index("ix_solid_models_public_token", table_name="solid_models")
    op.drop_index("ix_solid_models_owner_updated", table_name="solid_models")
    op.drop_index("ix_solid_models_owner_id", table_name="solid_models")
    op.drop_index("ix_solid_models_tenant_id", table_name="solid_models")
    op.drop_table("solid_models")
