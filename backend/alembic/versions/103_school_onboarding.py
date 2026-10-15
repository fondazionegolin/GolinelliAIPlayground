"""School registry (MIM) and school onboarding invites.

Revision ID: 103_school_onboarding
Revises: 102_agentic_assistant_chats
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "103_school_onboarding"
down_revision = "102_agentic_assistant_chats"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "italian_schools",
        sa.Column("code", sa.String(16), primary_key=True),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("kind", sa.String(16), nullable=False),
        sa.Column("typology", sa.String(255)),
        sa.Column("plessi_summary", sa.Text()),
        sa.Column("region", sa.String(64)),
        sa.Column("province", sa.String(64)),
        sa.Column("comune", sa.String(128)),
        sa.Column("address", sa.String(255)),
        sa.Column("cap", sa.String(8)),
        sa.Column("email", sa.String(255)),
        sa.Column("pec", sa.String(255)),
        sa.Column("website", sa.String(255)),
        sa.Column("school_year", sa.String(8)),
        sa.Column("search_text", sa.Text(), nullable=False, server_default=""),
    )
    op.create_index("ix_italian_schools_kind", "italian_schools", ["kind"])
    op.create_index("ix_italian_schools_region", "italian_schools", ["region"])
    op.create_index("ix_italian_schools_province", "italian_schools", ["province"])

    op.create_table(
        "school_onboarding_invites",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("token", sa.String(64), nullable=False, unique=True),
        sa.Column("mode", sa.String(16), nullable=False),
        sa.Column("status", sa.String(16), nullable=False, server_default="PENDING"),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("tenants.id", ondelete="SET NULL")),
        sa.Column("mechanographic_code", sa.String(16)),
        sa.Column("email", sa.String()),
        sa.Column("first_name", sa.String()),
        sa.Column("last_name", sa.String()),
        sa.Column("custom_message", sa.Text()),
        sa.Column("label", sa.String(160)),
        sa.Column("created_by_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id")),
        sa.Column("claimed_user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("opened_at", sa.DateTime(timezone=True)),
        sa.Column("completed_at", sa.DateTime(timezone=True)),
        sa.Column("email_sent_at", sa.DateTime(timezone=True)),
    )
    op.create_index("ix_school_onboarding_invites_token", "school_onboarding_invites", ["token"], unique=True)
    op.create_index("ix_school_onboarding_invites_status", "school_onboarding_invites", ["status"])
    op.create_index("ix_school_onboarding_invites_tenant_id", "school_onboarding_invites", ["tenant_id"])
    op.create_index("ix_school_invites_tenant_status", "school_onboarding_invites", ["tenant_id", "status"])

    op.add_column("tenants", sa.Column("mechanographic_code", sa.String(16)))
    op.add_column("tenants", sa.Column("registry_verified", sa.Boolean(), nullable=False, server_default="false"))
    op.create_index("ix_tenants_mechanographic_code", "tenants", ["mechanographic_code"], unique=True)


def downgrade():
    op.drop_index("ix_tenants_mechanographic_code", table_name="tenants")
    op.drop_column("tenants", "registry_verified")
    op.drop_column("tenants", "mechanographic_code")
    op.drop_table("school_onboarding_invites")
    op.drop_table("italian_schools")
