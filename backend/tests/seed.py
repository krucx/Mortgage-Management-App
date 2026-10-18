"""Test data made through the change modules, as the app makes it, for tests below the
HTTP interface: a seed the app would refuse (an overpayment, a Customer on someone
else's number) fails at setup, and everything it does is in History.

Each change is made on its own date, as the Lender would have made it that day: a
Mortgage on its start date, a Payment on the day it was paid, a Closure or Term Change
on the day it takes effect. So a seed is refused exactly when the app would have
refused it then.
"""

from datetime import date, datetime, time

from sqlalchemy.engine import Connection

from mortgage_backend import changes, customer_changes
from mortgage_backend.changes import (
    AllocationIn,
    ForfeitIn,
    PaymentIn,
    RedeemIn,
    TermChangeIn,
)
from mortgage_backend.customers import CustomerIn
from mortgage_backend.mortgages import MortgageIn
from mortgage_backend.replay import mortgage_row
from mortgage_backend.terms import Terms

RUPEE = 100  # paise
LAKH = 1_00_000 * RUPEE


# ₹3,000 a month on ₹1,00,000, never capitalised; a full month charged on redemption.
SIMPLE_3 = Terms(
    monthly_rate_bps=300, interest_mode="simple", part_month_rule="full_month"
)


def _at(day: date) -> datetime:
    """When History says a change made on `day` was made."""
    return datetime.combine(day, time(10, 0))


def add_customer(
    conn: Connection, phone: str = "9829012345", name: str = "Ramesh Kumar"
) -> int:
    return customer_changes.create_customer(
        conn, CustomerIn(name=name, address="", phone_1=phone), _at(date(2025, 1, 1))
    )


def add_mortgage(
    conn: Connection,
    customer_id: int,
    suffix: str = "Chain",
    start_date: date = date(2026, 1, 14),
    amount_lent: int = LAKH,
    description: str = "Gold chain",
    terms: Terms = SIMPLE_3,
    collateral: int | None = None,
) -> int:
    """A Mortgage named <start year>-Ramesh-<suffix>, of 19 g of 22K gold; with
    `collateral`, valued by hand at that when it was lent."""
    mortgage_id = changes.create_mortgage(
        conn,
        MortgageIn(
            customer_id=customer_id,
            name=f"{start_date.year}-Ramesh-{suffix}",
            start_date=start_date,
            amount_lent=amount_lent,
            description=description,
            gross_weight_mg=20_000,
            net_weight_mg=19_000,
            purity_karat=22,
            terms=terms,
        ),
        start_date,
        _at(start_date),
    )
    if collateral is not None:
        changes.set_collateral(
            conn, mortgage_id, collateral, start_date, _at(start_date)
        )
    return mortgage_id


def add_payment(
    conn: Connection,
    customer_id: int,
    paid_on: date,
    allocations: dict[int, int],
    voided: bool = False,
) -> int:
    """A cash Payment of `allocations` (paise by Mortgage id); Voided if `voided`."""
    payment_id = changes.record_payment(
        conn,
        PaymentIn(
            customer_id=customer_id,
            paid_on=paid_on,
            amount=sum(allocations.values()),
            method="cash",
            allocations=[
                AllocationIn(mortgage_id=mortgage_id, amount=amount)
                for mortgage_id, amount in allocations.items()
            ],
        ),
        paid_on,
        _at(paid_on),
    )
    if voided:
        changes.void_payment(conn, payment_id, "mistake", paid_on, _at(paid_on))
    return payment_id


def add_term_change(
    conn: Connection, mortgage_id: int, on: date, monthly_rate_bps: int
) -> None:
    """A new rate from the Accrual Date `on`."""
    changes.add_term_change(
        conn,
        mortgage_id,
        TermChangeIn(effective_on=on, monthly_rate_bps=monthly_rate_bps),
        on,
        _at(on),
    )


def redeem(conn: Connection, mortgage_id: int, on: date) -> int | None:
    """Redeem the Mortgage on `on`, paying the Redemption Amount in cash; the final
    Payment's id (None if nothing was owed)."""
    redeemed = RedeemIn(redeemed_on=on, method="cash")
    changes.redeem(conn, mortgage_id, redeemed, on, _at(on))
    final: int | None = mortgage_row(conn, mortgage_id)["redemption_payment_id"]
    return final


def forfeit(conn: Connection, mortgage_id: int, on: date, recovered: int = 0) -> None:
    """Forfeit the Mortgage on `on`, its jewellery recovering `recovered` (paise)."""
    changes.forfeit(
        conn,
        mortgage_id,
        ForfeitIn(forfeited_on=on, recovered_amount=recovered),
        on,
        _at(on),
    )
