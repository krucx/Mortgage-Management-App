"""Customers and standalone Referrers.

Revision ID: 0002
Revises: 0001
"""

import sqlalchemy as sa
from alembic import op

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "standalone_referrer",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("address", sa.String(), nullable=False),
        sa.Column("phone", sa.String(), nullable=False),
    )
    op.create_table(
        "customer",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("address", sa.String(), nullable=False),
        sa.Column("phone_1", sa.String(), nullable=False, index=True),
        sa.Column("phone_2", sa.String(), index=True),
        sa.Column("photo", sa.String()),
        sa.Column(
            "referred_by_customer_id", sa.Integer(), sa.ForeignKey("customer.id")
        ),
        sa.Column(
            "referred_by_standalone_referrer_id",
            sa.Integer(),
            sa.ForeignKey("standalone_referrer.id"),
        ),
        sa.Column(
            "created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()
        ),
    )


def downgrade() -> None:
    op.drop_table("customer")
    op.drop_table("standalone_referrer")
