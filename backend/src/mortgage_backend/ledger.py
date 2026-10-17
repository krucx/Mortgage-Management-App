"""The ledger engine: a Mortgage's Ledger is computed, never stored (ADR 0001).

Pure functions only, no database: the Ledger is a replay of the Mortgage's Terms and
its Payment Allocations up to a date.
"""

import calendar
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import date, timedelta
from typing import Literal

from mortgage_backend.terms import InterestMode, PartMonthRule, Terms

LedgerEvent = Literal[
    "started", "interest", "part_month", "payment", "capitalised", "forfeited"
]


@dataclass(frozen=True)
class Allocation:
    """The part of a Payment applied to this Mortgage."""

    on: date
    amount: int  # paise
    payment_id: int


@dataclass(frozen=True)
class LedgerStep:
    on: date
    event: LedgerEvent
    amount: int  # paise moved by this step
    principal: int  # running Principal after the step, in paise
    unpaid_interest: int  # running unpaid interest after the step, in paise
    # interest / part_month steps: the Principal at the start of that month
    charged_on: int = 0
    part_month_days: int = 0  # part_month steps: days since the last Accrual Date
    interest_paid: int = 0  # payment steps: the part that paid interest
    principal_paid: int = 0  # payment steps: the part that paid Principal
    payment_id: int | None = None


class Overpayment(Exception):
    """An Allocation larger than everything owed on its date."""

    def __init__(self, allocation: Allocation, outstanding: int) -> None:
        super().__init__(
            f"Payment of {allocation.amount} paise on {allocation.on} exceeds the "
            f"{outstanding} paise owed"
        )
        self.payment_id = allocation.payment_id
        self.on = allocation.on
        self.outstanding = outstanding


def accrual_date(start: date, n: int) -> date:
    """The n-th monthly Accrual Date: the start day, or month-end when the month is shorter."""
    months = start.month - 1 + n
    year, month = start.year + months // 12, months % 12 + 1
    return date(year, month, min(start.day, calendar.monthrange(year, month)[1]))


DAYS_IN_A_MONTH = 30  # the pro-rata Part-Month Rule counts days out of 30


def monthly_interest(principal: int, terms: Terms, days: int = DAYS_IN_A_MONTH) -> int:
    """Interest for a month (or `days` of 30) in paise, rounded half-up to the rupee."""
    paise_per_rupee = 100
    # basis points, then days of 30, then paise → rupees
    denominator = 10_000 * DAYS_IN_A_MONTH * paise_per_rupee
    numerator = principal * terms.monthly_rate_bps * days
    rupees = (2 * numerator + denominator) // (2 * denominator)
    return rupees * paise_per_rupee


def days_since_accrual(start: date, on: date) -> int:
    """Days from the last Accrual Date (or the start, before any) up to `on`."""
    n = 0
    while accrual_date(start, n + 1) <= on:
        n += 1
    return (on - accrual_date(start, n)).days


def part_month_charge(principal: int, terms: Terms, days: int) -> int:
    """The Part-Month Rule charge for closing `days` after the last Accrual Date."""
    if days <= 0:
        return 0
    match terms.part_month_rule:
        case PartMonthRule.FULL_MONTH:
            return monthly_interest(principal, terms)
        case PartMonthRule.PRO_RATA:
            return monthly_interest(principal, terms, min(days, DAYS_IN_A_MONTH))
        case PartMonthRule.NOTHING:
            return 0


def _capitalises(terms: Terms, n: int) -> bool:
    match terms.interest_mode:
        case InterestMode.SIMPLE:
            return False
        case InterestMode.COMPOUNDED_YEARLY:
            return n % 12 == 0
        case InterestMode.COMPOUNDED_MONTHLY:
            return True


def compute_ledger(
    start: date,
    amount_lent: int,
    terms: Terms,
    as_of: date,
    allocations: Iterable[Allocation] = (),
    closed_on: date | None = None,
    forfeited: bool = False,
) -> list[LedgerStep]:
    """Replay a Mortgage from its start up to and including `as_of`.

    A Mortgage closed (Redeemed or Forfeited) on `closed_on` accrues nothing after it; on
    that date the Part-Month Rule charge for the days since the last Accrual Date is added
    before that day's Payments, so a final Payment can include it. A Forfeited Mortgage's
    remaining debt is then settled by the jewellery, leaving nothing Outstanding.

    Each month's interest is charged on the Principal as it stood at the start of that
    month (the previous Accrual Date), so paying Principal mid-month lowers interest only
    from the next month (ADR 0006). On any one date the order is: that day's interest,
    then Payments, then capitalisation, so paying on an Accrual Date clears that day's
    interest before it compounds and counts for the month that starts then.
    Raises Overpayment if an Allocation exceeds what is owed on its date.
    """
    if closed_on is not None:
        as_of = min(as_of, closed_on)
    principal, unpaid = amount_lent, 0
    steps = [LedgerStep(start, "started", amount_lent, principal, unpaid)]
    pending = sorted(
        (a for a in allocations if a.on <= as_of), key=lambda a: (a.on, a.payment_id)
    )

    def pay_through(day: date) -> None:
        nonlocal principal, unpaid
        while pending and pending[0].on <= day:
            allocation = pending.pop(0)
            if allocation.amount > principal + unpaid:
                raise Overpayment(allocation, principal + unpaid)
            to_interest = min(allocation.amount, unpaid)
            to_principal = allocation.amount - to_interest
            unpaid -= to_interest
            principal -= to_principal
            steps.append(
                LedgerStep(
                    allocation.on,
                    "payment",
                    allocation.amount,
                    principal,
                    unpaid,
                    interest_paid=to_interest,
                    principal_paid=to_principal,
                    payment_id=allocation.payment_id,
                )
            )

    month_start_principal = principal
    n = 1
    while (on := accrual_date(start, n)) <= as_of:
        pay_through(on - timedelta(days=1))  # Payments before this Accrual Date
        interest = monthly_interest(month_start_principal, terms)
        unpaid += interest
        steps.append(
            LedgerStep(
                on,
                "interest",
                interest,
                principal,
                unpaid,
                charged_on=month_start_principal,
            )
        )
        pay_through(on)
        if _capitalises(terms, n) and unpaid:
            principal, capitalised, unpaid = principal + unpaid, unpaid, 0
            steps.append(LedgerStep(on, "capitalised", capitalised, principal, unpaid))
        month_start_principal = principal  # the next month starts now
        n += 1

    if closed_on is not None and closed_on == as_of:
        pay_through(closed_on - timedelta(days=1))
        days = days_since_accrual(start, closed_on)
        charge = part_month_charge(month_start_principal, terms, days)
        if charge:
            unpaid += charge
            steps.append(
                LedgerStep(
                    closed_on,
                    "part_month",
                    charge,
                    principal,
                    unpaid,
                    charged_on=month_start_principal,
                    part_month_days=days,
                )
            )
    pay_through(as_of)
    if forfeited and closed_on == as_of:
        steps.append(LedgerStep(closed_on, "forfeited", principal + unpaid, 0, 0))
    return steps


def months_unpaid(steps: Iterable[LedgerStep]) -> int:
    """How many of the latest monthly interest charges the Payments have not covered.

    Each Payment covers the interest charged so far, oldest month first; whatever is
    left pays Principal and cannot cover later months. Capitalised interest still
    counts as unpaid. A partly covered month counts as unpaid.
    """
    uncovered: list[int] = []  # the unpaid part of each month's interest, oldest first
    for step in steps:
        if step.event == "interest":
            uncovered.append(step.amount)
        elif step.event == "payment":
            left = step.amount
            while uncovered and left:
                paid = min(left, uncovered[0])
                uncovered[0] -= paid
                left -= paid
                if not uncovered[0]:
                    uncovered.pop(0)
    return sum(1 for charge in uncovered if charge)
