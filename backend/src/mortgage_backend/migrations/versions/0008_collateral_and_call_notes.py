"""Manual Collateral Values and Call Notes.

Revision ID: 0008
Revises: 0007
"""

import sqlalchemy as sa
from alembic import op

revision = "0008"
down_revision = "0007"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Plain ADD COLUMN: a batch table rebuild would drop the lower(name) unique index.
    op.add_column("mortgage", sa.Column("collateral_override", sa.Integer()))
    op.add_column("mortgage", sa.Column("collateral_override_on", sa.Date()))
    op.create_table(
        "call_note",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "mortgage_id",
            sa.Integer(),
            sa.ForeignKey("mortgage.id"),
            nullable=False,
            index=True,
        ),
        sa.Column("called_on", sa.Date(), nullable=False),
        sa.Column("note", sa.String(), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()
        ),
    )


def downgrade() -> None:
    op.drop_table("call_note")
    op.drop_column("mortgage", "collateral_override_on")
    op.drop_column("mortgage", "collateral_override")
