"""A Grace Payment's received date, and the amount it let off on each Mortgage.

Revision ID: 0018
Revises: 0017
"""

import sqlalchemy as sa
from alembic import op

revision = "0018"
down_revision = "0017"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("payment", sa.Column("received_on", sa.Date(), nullable=True))
    op.add_column("allocation", sa.Column("let_off", sa.Integer(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("allocation") as batch:
        batch.drop_column("let_off")
    with op.batch_alter_table("payment") as batch:
        batch.drop_column("received_on")
