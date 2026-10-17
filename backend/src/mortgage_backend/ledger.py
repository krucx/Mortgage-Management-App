"""The ledger engine: a Mortgage's Ledger is computed, never stored (ADR 0001).

Pure functions only — no database — so the same replay serves history today and,
later, Projections into the future.
"""

import calendar
from dataclasses import dataclass
from datetime import date
from typing import Literal

from mortgage_backend.terms import InterestMode, Terms

LedgerEvent = Literal["started", "interest", "capitalised"]


@dataclass(frozen=True)
class LedgerStep:
    on: date
    event: LedgerEvent
    amount: int  # paise moved by this step
    principal: int  # running Principal after the step, in paise
    unpaid_interest: int  # running unpaid interest after the step, in paise


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
    start: date, principal: int, terms: Terms, as_of: date
) -> list[LedgerStep]:
    """Replay a Mortgage from its start up to and including `as_of`."""
    unpaid = 0
    steps = [LedgerStep(start, "started", principal, principal, unpaid)]
    n = 1
    while (on := accrual_date(start, n)) <= as_of:
        interest = monthly_interest(principal, terms)
        unpaid += interest
        steps.append(LedgerStep(on, "interest", interest, principal, unpaid))
        if _capitalises(terms, n) and unpaid:
            principal, capitalised, unpaid = principal + unpaid, unpaid, 0
            steps.append(LedgerStep(on, "capitalised", capitalised, principal, unpaid))
        n += 1
    return steps
