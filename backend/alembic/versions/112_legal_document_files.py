"""Legal documents uploaded from the admin Licenze section."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "112_legal_document_files"
down_revision = "111_smart_canvas_preview"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "legal_document_files",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("document_key", sa.String(64), nullable=False, index=True),
        sa.Column("version", sa.String(64), nullable=False),
        sa.Column("title", sa.String(180), nullable=False),
        sa.Column("filename", sa.String(255), nullable=True),
        sa.Column("size_bytes", sa.Integer(), nullable=False),
        sa.Column("data", sa.LargeBinary(), nullable=False),
        sa.Column("uploaded_by", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("uploaded_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("document_key", "version", name="uq_legal_document_file_key_version"),
    )


def downgrade():
    op.drop_table("legal_document_files")
