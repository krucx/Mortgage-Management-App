"""A Payment that Redeems records each Mortgage's final Payment apart from the rest, so
the Payments recorded from one sum point at the first of them, whose Receipt they share.

Revision ID: 0013
Revises: 0012
"""

import sqlalchemy as sa
from alembic import op

revision = "0013"
down_revision = "0012"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("payment") as batch:
        batch.add_column(sa.Column("received_with", sa.Integer(), nullable=True))
        batch.create_foreign_key(
            "fk_payment_received_with", "payment", ["received_with"], ["id"]
        )


def downgrade() -> None:
    with op.batch_alter_table("payment") as batch:
        batch.drop_constraint("fk_payment_received_with", type_="foreignkey")
        batch.drop_column("received_with")
