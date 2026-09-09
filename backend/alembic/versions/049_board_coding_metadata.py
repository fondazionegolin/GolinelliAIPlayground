"""board coding metadata

Revision ID: 049_board_coding_metadata
Revises: 048_generic_boards
Create Date: 2026-06-30 14:20:00.000000
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "049_board_coding_metadata"
down_revision = "048_generic_boards"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("boards", sa.Column("coding_project_id", postgresql.UUID(as_uuid=True), nullable=True))
    op.create_foreign_key(
        "fk_boards_coding_project_id_coding_projects",
        "boards",
        "coding_projects",
        ["coding_project_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index("ix_boards_coding_project_id", "boards", ["coding_project_id"])

    op.add_column("board_cards", sa.Column("color", sa.String(length=24), nullable=True))
    op.add_column("board_cards", sa.Column("coding_project_id", postgresql.UUID(as_uuid=True), nullable=True))
    op.add_column("board_cards", sa.Column("coding_status", sa.String(length=40), nullable=True))
    op.create_foreign_key(
        "fk_board_cards_coding_project_id_coding_projects",
        "board_cards",
        "coding_projects",
        ["coding_project_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index("ix_board_cards_coding_project_id", "board_cards", ["coding_project_id"])


def downgrade() -> None:
    op.drop_index("ix_board_cards_coding_project_id", table_name="board_cards")
    op.drop_constraint("fk_board_cards_coding_project_id_coding_projects", "board_cards", type_="foreignkey")
    op.drop_column("board_cards", "coding_status")
    op.drop_column("board_cards", "coding_project_id")
    op.drop_column("board_cards", "color")

    op.drop_index("ix_boards_coding_project_id", table_name="boards")
    op.drop_constraint("fk_boards_coding_project_id_coding_projects", "boards", type_="foreignkey")
    op.drop_column("boards", "coding_project_id")
