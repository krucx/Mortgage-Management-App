"""A per-Mortgage Discount recorded alongside each cash Allocation.

Revision ID: 0016
Revises: 0015
"""

import sqlalchemy as sa
from alembic import op

revision = "0016"
down_revision = "0015"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "allocation", sa.Column("discount", sa.Integer(), nullable=False, server_default="0")
    )


def downgrade() -> None:
    with op.batch_alter_table("allocation") as batch:
        batch.drop_column("discount")
