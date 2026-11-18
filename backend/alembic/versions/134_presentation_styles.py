"""Saved slide styles (background, fonts, sizes, colours) reusable on a slide or a whole deck."""
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql
from alembic import op

revision = "134_presentation_styles"
down_revision = "133_call_translations"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "presentation_styles",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("owner_user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=True),
        sa.Column("owner_student_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("session_students.id", ondelete="CASCADE"), nullable=True),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("style_json", postgresql.JSONB(), nullable=False, server_default="{}"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    for column in ("tenant_id", "owner_user_id", "owner_student_id"):
        op.create_index(f"ix_presentation_styles_{column}", "presentation_styles", [column])


def downgrade():
    op.drop_table("presentation_styles")
