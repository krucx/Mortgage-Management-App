"""The Primary Number identifies a person: unique across Customers and Standalone Referrers.

Replaces the name + contact number 1 rule from 0003.

Revision ID: 0004
Revises: 0003
"""

import sqlalchemy as sa
from alembic import op

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()

    # A Standalone Referrer sharing a Customer's Primary Number is that Customer:
    # promote them, exactly as the app does (their referrals move to the Customer).
    conn.execute(
        sa.text(
            "UPDATE customer SET"
            "  referred_by_customer_id = (SELECT c.id FROM customer c"
            "    JOIN standalone_referrer r ON r.phone = c.phone_1"
            "    WHERE r.id = customer.referred_by_standalone_referrer_id),"
            "  referred_by_standalone_referrer_id = NULL"
            " WHERE referred_by_standalone_referrer_id IN (SELECT r.id FROM standalone_referrer r"
            "   JOIN customer c ON c.phone_1 = r.phone)"
        )
    )
    conn.execute(
        sa.text(
            "DELETE FROM standalone_referrer"
            " WHERE phone IN (SELECT phone_1 FROM customer)"
        )
    )

    # Anything still shared (two Customers, or two Referrers) needs the Lender to decide.
    clashes = conn.execute(
        sa.text(
            "SELECT phone, group_concat(who, ', ') FROM ("
            "  SELECT phone_1 AS phone, 'Customer ' || name AS who FROM customer"
            "  UNION ALL"
            "  SELECT phone, 'Referrer ' || name FROM standalone_referrer"
            ") GROUP BY phone HAVING count(*) > 1"
        )
    ).all()
    if clashes:
        listing = "; ".join(f"{phone}: {who}" for phone, who in clashes)
        raise RuntimeError(
            f"These Primary Numbers are shared and must be fixed first: {listing}"
        )

    op.drop_index("uq_customer_name_phone_1", table_name="customer")
    op.drop_index("ix_customer_phone_1", table_name="customer")
    op.create_index("ix_customer_phone_1", "customer", ["phone_1"], unique=True)
    op.create_index(
        "ix_standalone_referrer_phone", "standalone_referrer", ["phone"], unique=True
    )


def downgrade() -> None:
    op.drop_index("ix_standalone_referrer_phone", table_name="standalone_referrer")
    op.drop_index("ix_customer_phone_1", table_name="customer")
    op.create_index("ix_customer_phone_1", "customer", ["phone_1"])
    op.create_index(
        "uq_customer_name_phone_1",
        "customer",
        [sa.text("lower(name)"), "phone_1"],
        unique=True,
    )
