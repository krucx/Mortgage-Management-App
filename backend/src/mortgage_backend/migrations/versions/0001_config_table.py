"""Config table seeded with the default Terms for new Mortgages.

Revision ID: 0001
Revises:
"""

import sqlalchemy as sa
from alembic import op

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    config = op.create_table(
        "config",
        sa.Column("key", sa.String(), primary_key=True),
        sa.Column("value", sa.String(), nullable=False),
    )
    op.bulk_insert(
        config,
        [
            {"key": "default_monthly_rate_bps", "value": "300"},
            {"key": "default_interest_mode", "value": "compounded_yearly"},
            {"key": "default_part_month_rule", "value": "full_month"},
        ],
    )


def downgrade() -> None:
    op.drop_table("config")
