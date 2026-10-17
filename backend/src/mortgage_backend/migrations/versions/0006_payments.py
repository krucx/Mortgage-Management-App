"""Payments and their Allocations to Mortgages.

Revision ID: 0006
Revises: 0005
"""

import sqlalchemy as sa
from alembic import op

revision = "0006"
down_revision = "0005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "payment",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "customer_id", sa.Integer(), sa.ForeignKey("customer.id"), nullable=False
        ),
        sa.Column("paid_on", sa.Date(), nullable=False),
        sa.Column("amount", sa.Integer(), nullable=False),
        sa.Column("method", sa.String(), nullable=False),
        sa.Column("reference", sa.String()),
        sa.Column(
            "created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()
        ),
    )
    op.create_index("ix_payment_customer_id", "payment", ["customer_id"])
    op.create_table(
        "allocation",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "payment_id", sa.Integer(), sa.ForeignKey("payment.id"), nullable=False
        ),
        sa.Column(
            "mortgage_id", sa.Integer(), sa.ForeignKey("mortgage.id"), nullable=False
        ),
        sa.Column("amount", sa.Integer(), nullable=False),
    )
    op.create_index("ix_allocation_payment_id", "allocation", ["payment_id"])
    op.create_index("ix_allocation_mortgage_id", "allocation", ["mortgage_id"])


def downgrade() -> None:
    op.drop_table("allocation")
    op.drop_table("payment")
