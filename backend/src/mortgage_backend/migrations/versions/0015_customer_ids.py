"""A Customer's optional email, Aadhaar Number (the last 4 digits only), PAN and ID
Photos: empty for the Customers made before.

Revision ID: 0015
Revises: 0014
"""

import sqlalchemy as sa
from alembic import op

revision = "0015"
down_revision = "0014"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("customer") as batch:
        batch.add_column(sa.Column("email", sa.String(), nullable=True))
        batch.add_column(sa.Column("aadhaar_last4", sa.String(), nullable=True))
        batch.add_column(sa.Column("pan", sa.String(), nullable=True))
        batch.add_column(sa.Column("aadhaar_photo", sa.String(), nullable=True))
        batch.add_column(sa.Column("pan_photo", sa.String(), nullable=True))
        batch.create_index("ix_customer_pan", ["pan"], unique=True)


def downgrade() -> None:
    with op.batch_alter_table("customer") as batch:
        batch.drop_index("ix_customer_pan")
        for column in ("pan_photo", "aadhaar_photo", "pan", "aadhaar_last4", "email"):
            batch.drop_column(column)
