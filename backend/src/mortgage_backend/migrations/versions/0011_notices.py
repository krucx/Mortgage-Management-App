"""Notices to Customers ahead of Accrual Dates.

Revision ID: 0011
Revises: 0010
"""

import sqlalchemy as sa
from alembic import op

revision = "0011"
down_revision = "0010"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "notice",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "customer_id", sa.Integer(), sa.ForeignKey("customer.id"), nullable=False
        ),
        sa.Column("accrues_on", sa.Date(), nullable=False),
        sa.Column("created_on", sa.Date(), nullable=False),
        # awaiting_approval, queued, sent or skipped
        sa.Column("status", sa.String(), nullable=False),
        # Kept once sent or skipped; until then it is worked out when read.
        sa.Column("message", sa.String()),
        sa.Column("sent_at", sa.DateTime()),
        # One per Customer per Accrual Date, however often the daily run repeats.
        sa.UniqueConstraint("customer_id", "accrues_on"),
    )
    op.create_table(
        "notice_mortgage",
        sa.Column(
            "notice_id", sa.Integer(), sa.ForeignKey("notice.id"), primary_key=True
        ),
        sa.Column(
            "mortgage_id", sa.Integer(), sa.ForeignKey("mortgage.id"), primary_key=True
        ),
    )


def downgrade() -> None:
    op.drop_table("notice_mortgage")
    op.drop_table("notice")
