"""Advance Instalments: each part of an Advance, an Allocation dated one of its
Mortgage's Accrual Dates after the Payment was received (ADR 0021).

Revision ID: 0019
Revises: 0018
"""

import sqlalchemy as sa
from alembic import op

revision = "0019"
down_revision = "0018"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "advance_instalment",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "payment_id", sa.Integer(), sa.ForeignKey("payment.id"), nullable=False
        ),
        sa.Column(
            "mortgage_id", sa.Integer(), sa.ForeignKey("mortgage.id"), nullable=False
        ),
        sa.Column("on", sa.Date(), nullable=False),
        sa.Column("amount", sa.Integer(), nullable=False),
    )
    op.create_index(
        "ix_advance_instalment_payment_id", "advance_instalment", ["payment_id"]
    )
    op.create_index(
        "ix_advance_instalment_mortgage_id", "advance_instalment", ["mortgage_id"]
    )


def downgrade() -> None:
    op.drop_table("advance_instalment")
