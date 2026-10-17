"""The ledger engine: a Mortgage's Ledger is computed, never stored (ADR 0001).

Pure functions only, no database: the Ledger is a replay of the Mortgage's Terms and
its Payment Allocations up to a date.
"""

import calendar
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import date, timedelta
from typing import Literal

from mortgage_backend.terms import InterestMode, Terms

LedgerEvent = Literal["started", "interest", "payment", "capitalised"]


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
    charged_on: int = (
        0  # interest steps: the Principal the month's interest was charged on
    )
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


def monthly_interest(principal: int, terms: Terms) -> int:
    """One month's interest in paise, rounded half-up to the nearest rupee."""
    paise_per_rupee = 100
    denominator = 10_000 * paise_per_rupee  # basis points, then paise → rupees
    rupees = (2 * principal * terms.monthly_rate_bps + denominator) // (2 * denominator)
    return rupees * paise_per_rupee


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
) -> list[LedgerStep]:
    """Replay a Mortgage from its start up to and including `as_of`.

    Each month's interest is charged on the Principal as it stood at the start of that
    month (the previous Accrual Date), so paying Principal mid-month lowers interest only
    from the next month (ADR 0006). On any one date the order is: that day's interest,
    then Payments, then capitalisation, so paying on an Accrual Date clears that day's
    interest before it compounds and counts for the month that starts then.
    Raises Overpayment if an Allocation exceeds what is owed on its date.
    """
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
    pay_through(as_of)
    return steps
