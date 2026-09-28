"""Dataflow Studio: a node can run several times per run (loops, repeat-until)

Revision ID: 082_agentic_node_run_visits
Revises: 081_solid_models_student
"""

from alembic import op
import sqlalchemy as sa


revision = "082_agentic_node_run_visits"
down_revision = "081_solid_models_student"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("agentic_node_runs", sa.Column("visit", sa.Integer(), nullable=False, server_default="0"))
    op.drop_constraint("uq_agentic_node_runs_run_node", "agentic_node_runs", type_="unique")
    op.create_unique_constraint("uq_agentic_node_runs_run_node_visit", "agentic_node_runs", ["run_id", "node_instance_id", "visit"])


def downgrade():
    op.execute("DELETE FROM agentic_node_runs WHERE visit > 0")
    op.drop_constraint("uq_agentic_node_runs_run_node_visit", "agentic_node_runs", type_="unique")
    op.create_unique_constraint("uq_agentic_node_runs_run_node", "agentic_node_runs", ["run_id", "node_instance_id"])
    op.drop_column("agentic_node_runs", "visit")
