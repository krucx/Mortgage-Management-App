"""One Customer per name (ignoring case) and contact number 1.

Revision ID: 0003
Revises: 0002
"""

import sqlalchemy as sa
from alembic import op

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    duplicates = (
        op.get_bind()
        .execute(
            sa.text(
                "SELECT lower(name), phone_1, group_concat(id) FROM customer"
                " GROUP BY lower(name), phone_1 HAVING count(*) > 1"
            )
        )
        .all()
    )
    if duplicates:
        # Never delete the Lender's data automatically; they must merge these by hand.
        listing = "; ".join(
            f"{name} / {phone} (ids {ids})" for name, phone, ids in duplicates
        )
        raise RuntimeError(
            f"Duplicate Customers must be resolved before upgrading: {listing}"
        )
    op.create_index(
        "uq_customer_name_phone_1",
        "customer",
        [sa.text("lower(name)"), "phone_1"],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index("uq_customer_name_phone_1", table_name="customer")
