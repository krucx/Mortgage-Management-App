"""The ledger engine: a Mortgage's Ledger is computed, never stored (ADR 0001).

Pure functions only, no database: the Ledger is a replay of the Mortgage's Terms and
its Payment Allocations up to a date.
"""

import calendar
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from datetime import date, timedelta
from typing import Literal

from mortgage_backend.lending.terms import InterestMode, PartMonthRule, Terms

LedgerEvent = Literal[
    "started",
    "interest",
    "interest_to_date",
    "payment",
    "capitalised",
    "forfeited",
    "waived",
    "term_changed",
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
    # interest / interest_to_date steps: the Principal at the start of that month
    charged_on: int = 0
    # interest_to_date steps: days of the month charged, from its first day through `on`
    part_month_days: int = 0
    interest_paid: int = 0  # payment steps: the part that paid interest
    principal_paid: int = 0  # payment steps: the part that paid Principal
    payment_id: int | None = None  # None for a hypothetical Payment in a Projection
    terms: Terms | None = None  # term_changed steps: the Terms from then on


@dataclass(frozen=True)
class TermChange:
    """What changes for the months starting on `on`, an Accrual Date; anything left
    as None carries over from the Terms in force then."""

    on: date
    monthly_rate_bps: int | None = None
    interest_mode: InterestMode | None = None
    part_month_rule: PartMonthRule | None = None
    id: int | None = None  # the stored Term Change, if any

    def apply(self, terms: Terms) -> Terms:
        changed = {
            field: value
            for field in ("monthly_rate_bps", "interest_mode", "part_month_rule")
            if (value := getattr(self, field)) is not None
        }
        return Terms.model_validate({**terms.model_dump(), **changed})


def terms_on(terms: Terms, changes: Iterable[TermChange], day: date) -> Terms:
    """The Terms for a month starting on `day`: each Term Change in date order."""
    for change in sorted(changes, key=lambda change: change.on):
        if change.on <= day:
            terms = change.apply(terms)
    return terms


@dataclass(frozen=True)
class HypotheticalPayments:
    """For a Projection: `amount` paid on every Accrual Date after `after`, capped at
    what is owed, until nothing is."""

    after: date
    amount: int  # paise


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


def is_accrual_date(start: date, day: date) -> bool:
    months = (day.year - start.year) * 12 + day.month - start.month
    return months >= 1 and accrual_date(start, months) == day


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


def interest_to_date_days(start: date, on: date) -> int:
    """Days of the month under way charged by `on`: from its first day (the start or
    the last Accrual Date) through `on` itself, so today always counts."""
    return days_since_accrual(start, on) + 1


def part_month_charge(principal: int, terms: Terms, days: int) -> int:
    """The Interest to Date for `days` of a month, under its Part-Month Rule."""
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


class _Run:
    """One replay of a Mortgage, advanced date by date (see compute_ledger)."""

    def __init__(
        self,
        start: date,
        amount_lent: int,
        terms: Terms,
        allocations: Iterable[Allocation],
        until: date,
        term_changes: Iterable[TermChange],
        hypothetical: HypotheticalPayments | None,
    ) -> None:
        self.start, self.terms = start, terms
        self.changes = list(term_changes)
        self.hypothetical = hypothetical
        self.principal, self.unpaid = amount_lent, 0
        self.steps = [LedgerStep(start, "started", amount_lent, amount_lent, 0)]
        self.pending = sorted(
            (a for a in allocations if a.on <= until),
            key=lambda a: (a.on, a.payment_id),
        )
        self.month_start_principal = amount_lent
        self.n = 1  # the next Accrual Date's number
        self.paid_off_on: date | None = None  # by hypothetical Payments
        self.term_changes: list[tuple[date, Terms]] = []  # as they take effect

    def terms_from(self, day: date) -> Terms:
        return terms_on(self.terms, self.changes, day)

    def owed(self) -> int:
        return self.principal + self.unpaid

    def pay(self, on: date, amount: int, payment_id: int | None) -> None:
        """Interest first, then Principal."""
        to_interest = min(amount, self.unpaid)
        self.unpaid -= to_interest
        self.principal -= amount - to_interest
        self.steps.append(
            LedgerStep(
                on,
                "payment",
                amount,
                self.principal,
                self.unpaid,
                interest_paid=to_interest,
                principal_paid=amount - to_interest,
                payment_id=payment_id,
            )
        )
        if payment_id is None and not self.owed() and self.paid_off_on is None:
            self.paid_off_on = on

    def pay_through(self, day: date) -> None:
        while self.pending and self.pending[0].on <= day:
            allocation = self.pending.pop(0)
            if allocation.amount > self.owed():
                raise Overpayment(allocation, self.owed())
            self.pay(allocation.on, allocation.amount, allocation.payment_id)

    def accrue_through(self, day: date) -> None:
        """Every Accrual Date up to `day`, with the Payments before and on each."""
        while (on := accrual_date(self.start, self.n)) <= day:
            month_terms = self.terms_from(accrual_date(self.start, self.n - 1))
            self.pay_through(on - timedelta(days=1))  # Payments before this date
            interest = monthly_interest(self.month_start_principal, month_terms)
            self.unpaid += interest
            self.steps.append(
                LedgerStep(
                    on,
                    "interest",
                    interest,
                    self.principal,
                    self.unpaid,
                    charged_on=self.month_start_principal,
                )
            )
            self.pay_through(on)
            hypothetical = self.hypothetical
            if hypothetical and on > hypothetical.after and self.owed():
                self.pay(on, min(hypothetical.amount, self.owed()), None)
            if _capitalises(month_terms, self.n) and self.unpaid:
                self.principal, capitalised = self.owed(), self.unpaid
                self.unpaid = 0
                self.steps.append(
                    LedgerStep(on, "capitalised", capitalised, self.principal, 0)
                )
            if (new_terms := self.terms_from(on)) != month_terms:
                self.steps.append(
                    LedgerStep(
                        on,
                        "term_changed",
                        0,
                        self.principal,
                        self.unpaid,
                        terms=new_terms,
                    )
                )
                self.term_changes.append((on, new_terms))
            self.month_start_principal = self.principal  # the next month starts now
            self.n += 1

    def interest_to_date(self, on: date) -> tuple[int, int]:
        """The Interest to Date (and days charged) on `on`, once accrued through it."""
        days = interest_to_date_days(self.start, on)
        month_terms = self.terms_from(accrual_date(self.start, self.n - 1))
        return part_month_charge(self.month_start_principal, month_terms, days), days

    def charge_interest_to_date(self, on: date, cap: int | None = None) -> None:
        """Add the Interest to Date on `on` (no more than `cap`) as the Ledger's step."""
        charge, days = self.interest_to_date(on)
        if cap is not None:
            charge = min(charge, cap)
        if charge:
            self.unpaid += charge
            self.steps.append(
                LedgerStep(
                    on,
                    "interest_to_date",
                    charge,
                    self.principal,
                    self.unpaid,
                    charged_on=self.month_start_principal,
                    part_month_days=days,
                )
            )


def compute_ledger(
    start: date,
    amount_lent: int,
    terms: Terms,
    as_of: date,
    allocations: Iterable[Allocation] = (),
    closed_on: date | None = None,
    closure: Literal["redeemed", "waived", "forfeited"] | None = None,
    term_changes: Iterable[TermChange] = (),
    hypothetical: HypotheticalPayments | None = None,
    final_payment: int | None = None,
) -> list[LedgerStep]:
    """Replay a Mortgage from its start up to and including `as_of`.

    The Ledger ends with the Interest to Date on `as_of`: the month under way so far,
    today included, under its Part-Month Rule (ADR 0011). On an open Mortgage it changes
    from day to day, giving way to the month's interest on the next Accrual Date.

    A Mortgage closed on `closed_on` accrues nothing after it; with no `closure` given,
    that is a quote of closing then. Its Interest to Date on that date is fixed, after
    that day's other Payments and before its `final_payment` (the Closure's), so a
    final Payment of everything Outstanding closes it. A Redemption's Interest to Date is
    no more than its final Payment left for it, so a Redeemed Mortgage never owes
    anything. What a Waived or Forfeited Mortgage still owes after its final Payment is
    written off (waived by the Lender, or settled by the jewellery), leaving nothing
    Outstanding.

    Each month's interest is charged on the Principal as it stood at the start of that
    month (the previous Accrual Date), so paying Principal mid-month lowers interest only
    from the next month (ADR 0006). On any one date the order is: that day's interest,
    then Payments, then capitalisation, so paying on an Accrual Date clears that day's
    interest before it compounds and counts for the month that starts then.

    A Term Change on an Accrual Date applies to the months starting then: that day's
    interest and capitalisation still follow the old Terms, so no earlier interest
    changes. Hypothetical Payments, for Projections, come after that day's Payments.
    Raises Overpayment if an Allocation exceeds what is owed on its date.
    """
    if closed_on is not None:
        as_of = min(as_of, closed_on)
    closing = closed_on == as_of
    # The Closure's final Payment waits for its Interest to Date, so paying all that is
    # owed closes it; every other Payment comes before, as on any day.
    allocations = list(allocations)
    final = [
        a for a in allocations if closing and a.on == as_of and a.payment_id == final_payment
    ]
    run = _Run(
        start,
        amount_lent,
        terms,
        [a for a in allocations if a not in final],
        as_of,
        term_changes,
        hypothetical,
    )
    run.accrue_through(as_of)
    run.pay_through(as_of)
    cap = None
    if closing and closure == "redeemed":  # what the final Payment left for it
        cap = max(0, sum(a.amount for a in final) - run.owed())
    run.charge_interest_to_date(as_of, cap)
    run.pending = final
    run.pay_through(as_of)
    if closing and closure in ("waived", "forfeited"):
        run.steps.append(LedgerStep(as_of, closure, run.owed(), 0, 0))
    return run.steps


@dataclass(frozen=True)
class Snapshot:
    """Where a Mortgage stands at the end of a day."""

    on: date
    principal: int
    unpaid_interest: int
    redemption_amount: int  # its Outstanding: the Interest to Date included


@dataclass(frozen=True)
class Projected:
    snapshots: list[Snapshot]  # one per chosen date
    term_changes: list[tuple[date, Terms]]  # taking effect after the first date
    paid_off_on: date | None  # by the hypothetical Payments, if by `paid_off_by`


def project(
    start: date,
    amount_lent: int,
    terms: Terms,
    dates: Sequence[date],
    allocations: Iterable[Allocation] = (),
    term_changes: Iterable[TermChange] = (),
    hypothetical: HypotheticalPayments | None = None,
    paid_off_by: date | None = None,
) -> Projected:
    """A still-open Mortgage replayed once, reporting where it stands on each of
    `dates` (in order) and, with hypothetical Payments, when they pay it off (searching
    up to `paid_off_by`). Term Changes are those taking effect up to the last date."""
    last = max(dates[-1], paid_off_by or dates[-1])
    run = _Run(start, amount_lent, terms, allocations, last, term_changes, hypothetical)
    snapshots = []
    for on in dates:
        run.accrue_through(on)
        run.pay_through(on)
        charge, _ = run.interest_to_date(on)
        snapshots.append(Snapshot(on, run.principal, run.unpaid, run.owed() + charge))
    in_view = [c for c in run.term_changes if dates[0] < c[0] <= dates[-1]]
    if paid_off_by is not None:
        run.accrue_through(paid_off_by)
    return Projected(snapshots, in_view, run.paid_off_on)


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
