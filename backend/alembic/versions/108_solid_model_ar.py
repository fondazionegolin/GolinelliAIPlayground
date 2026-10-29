"""3D Lab: GLB snapshot of a solid model for augmented reality on the public link.

The editor uploads the GLB (built in the browser) together with a hash of the scene it was built from;
the public page uses it only while the hash still matches the saved scene.
"""
from alembic import op
import sqlalchemy as sa

revision = "108_solid_model_ar"
down_revision = "107_school_invite_tracking"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("solid_models", sa.Column("ar_glb", sa.LargeBinary(), nullable=True))
    op.add_column("solid_models", sa.Column("ar_scene_hash", sa.String(64), nullable=True))


def downgrade():
    op.drop_column("solid_models", "ar_scene_hash")
    op.drop_column("solid_models", "ar_glb")
