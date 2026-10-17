"""Term Changes on running Mortgages.

Revision ID: 0010
Revises: 0009
"""

import sqlalchemy as sa
from alembic import op

revision = "0010"
down_revision = "0009"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "term_change",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "mortgage_id", sa.Integer(), sa.ForeignKey("mortgage.id"), nullable=False
        ),
        sa.Column("effective_on", sa.Date(), nullable=False),
        # Only what changes; None carries over from the Terms in force then.
        sa.Column("monthly_rate_bps", sa.Integer()),
        sa.Column("interest_mode", sa.String()),
        sa.Column("part_month_rule", sa.String()),
        sa.Column(
            "created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()
        ),
        sa.UniqueConstraint("mortgage_id", "effective_on"),
    )


def downgrade() -> None:
    op.drop_table("term_change")
