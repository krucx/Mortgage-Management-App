"""A cancelled Advance Instalment: applied at once on the date it was cancelled, keeping
its original date on record (ADR 0021).

Revision ID: 0020
Revises: 0019
"""

import sqlalchemy as sa
from alembic import op

revision = "0020"
down_revision = "0019"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "advance_instalment", sa.Column("cancelled_on", sa.Date(), nullable=True)
    )


def downgrade() -> None:
    with op.batch_alter_table("advance_instalment") as batch:
        batch.drop_column("cancelled_on")
