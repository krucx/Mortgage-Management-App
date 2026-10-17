"""Mortgages and their photos.

Revision ID: 0005
Revises: 0004
"""

import sqlalchemy as sa
from alembic import op

revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "mortgage",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "customer_id", sa.Integer(), sa.ForeignKey("customer.id"), nullable=False
        ),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("start_date", sa.Date(), nullable=False),
        sa.Column("amount_lent", sa.Integer(), nullable=False),
        sa.Column("description", sa.String(), nullable=False),
        sa.Column("gross_weight_mg", sa.Integer(), nullable=False),
        sa.Column("net_weight_mg", sa.Integer(), nullable=False),
        sa.Column("purity_karat", sa.Integer(), nullable=False),
        sa.Column("monthly_rate_bps", sa.Integer(), nullable=False),
        sa.Column("interest_mode", sa.String(), nullable=False),
        sa.Column("part_month_rule", sa.String(), nullable=False),
        sa.Column("status", sa.String(), nullable=False, server_default="active"),
        sa.Column(
            "created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()
        ),
    )
    op.create_index("ix_mortgage_customer_id", "mortgage", ["customer_id"])
    op.create_index(
        "uq_mortgage_name", "mortgage", [sa.text("lower(name)")], unique=True
    )
    op.create_table(
        "mortgage_photo",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "mortgage_id", sa.Integer(), sa.ForeignKey("mortgage.id"), nullable=False
        ),
        sa.Column("file", sa.String(), nullable=False),
    )
    op.create_index("ix_mortgage_photo_mortgage_id", "mortgage_photo", ["mortgage_id"])


def downgrade() -> None:
    op.drop_table("mortgage_photo")
    op.drop_table("mortgage")
