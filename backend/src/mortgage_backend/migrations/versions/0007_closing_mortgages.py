"""Closing a Mortgage: Redemption or Forfeiture.

Revision ID: 0007
Revises: 0006
"""

import sqlalchemy as sa
from alembic import op

revision = "0007"
down_revision = "0006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Plain ADD COLUMN: a batch table rebuild would drop the lower(name) unique index.
    op.add_column("mortgage", sa.Column("closed_on", sa.Date()))
    # SQLite can add a referencing column in place, but Alembic only does it via batch.
    op.execute(
        "ALTER TABLE mortgage ADD COLUMN redemption_payment_id INTEGER REFERENCES payment (id)"
    )
    op.add_column("mortgage", sa.Column("recovered_amount", sa.Integer()))
    op.add_column("mortgage", sa.Column("closure_note", sa.String()))


def downgrade() -> None:
    for column in [
        "closure_note",
        "recovered_amount",
        "redemption_payment_id",
        "closed_on",
    ]:
        op.drop_column("mortgage", column)
