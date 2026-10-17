"""Projections: a Mortgage's Ledger continued into the future (see GLOSSARY.md).

The ledger engine replays the Mortgage past today, with its coming Term Changes and,
for "what if", hypothetical Payments; there is no separate maths.
"""

from datetime import date
from typing import Annotated, Literal

from fastapi import APIRouter, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy.engine import Connection, RowMapping

from mortgage_backend.clock import TodayDep
from mortgage_backend.collateral import collateral_of, gold_rates
from mortgage_backend.db import EngineDep
from mortgage_backend.ledger import (
    Allocation,
    HypotheticalPayments,
    LedgerStep,
    TermChange,
    accrual_date,
    compute_ledger,
)
from mortgage_backend.mortgages import (
    MortgageStatus,
    allocations_to,
    ledgers_of,
    mortgage_row,
    outstanding_of,
    quote_redemption,
    term_changes_of,
    terms_of,
)
from mortgage_backend.terms import Terms

MONTHS_AHEAD = 12
PAID_OFF_SEARCH_MONTHS = 120  # how far to look for when it would be paid off


class ProjectedPoint(BaseModel):
    months: int  # from today
    on: date
    principal: int
    unpaid_interest: int
    redemption_amount: int  # if Redeemed that day: Part-Month Rule charge included
    loan_to_value: float | None  # against today's Collateral Value


class ProjectedEvent(BaseModel):
    """Something in the coming year that changes how the Mortgage grows."""

    on: date
    kind: Literal["term_change", "capitalised"]
    amount: int  # capitalised: the interest added to the Principal
    terms: Terms | None  # term_change: the Terms from then on


class ProjectedSeries(BaseModel):
    points: list[ProjectedPoint]  # today, then each month for a year
    events: list[ProjectedEvent]  # Term Changes and capitalisations, after today
    paid_off_on: date | None  # within ten years, if ever


class Projection(BaseModel):
    as_of: date
    collateral_value: int | None
    monthly_payment: int | None
    baseline: ProjectedSeries  # no further Payments
    what_if: ProjectedSeries | None  # `monthly_payment` on every Accrual Date


def _series(
    row: RowMapping,
    allocations: list[Allocation],
    changes: list[TermChange],
    today: date,
    collateral_value: int | None,
    hypothetical: HypotheticalPayments | None,
) -> ProjectedSeries:
    def ledger(until: date) -> list[LedgerStep]:
        return compute_ledger(
            row["start_date"],
            row["amount_lent"],
            terms_of(row),
            until,
            allocations,
            term_changes=changes,
            hypothetical=hypothetical,
        )

    points = []
    for months in range(MONTHS_AHEAD + 1):
        on = accrual_date(today, months)
        last = ledger(on)[-1]
        owed = last.principal + last.unpaid_interest
        points.append(
            ProjectedPoint(
                months=months,
                on=on,
                principal=last.principal,
                unpaid_interest=last.unpaid_interest,
                redemption_amount=quote_redemption(
                    row, on, allocations, changes, hypothetical
                ).total,
                loan_to_value=owed / collateral_value if collateral_value else None,
            )
        )
    events = [
        ProjectedEvent(
            on=step.on,
            kind="term_change" if step.event == "term_changed" else "capitalised",
            amount=step.amount,
            terms=step.terms,
        )
        for step in ledger(points[-1].on)
        if step.on > today and step.event in ("term_changed", "capitalised")
    ]
    paid_off_on = None
    if hypothetical is not None:
        far = ledger(accrual_date(today, PAID_OFF_SEARCH_MONTHS))
        paid_off_on = next(
            (
                step.on
                for step in far
                if step.event == "payment"
                and step.payment_id is None
                and step.principal + step.unpaid_interest == 0
            ),
            None,
        )
    return ProjectedSeries(points=points, events=events, paid_off_on=paid_off_on)


def _inputs(
    conn: Connection, row: RowMapping, today: date
) -> tuple[list[Allocation], list[TermChange], int | None]:
    """What a Projection replays: Allocations, Term Changes, today's Collateral Value."""
    allocations = allocations_to(conn, [row["id"]])[row["id"]]
    changes = term_changes_of(conn, [row["id"]])[row["id"]]
    today_owed = outstanding_of(ledgers_of(conn, [row], today)[row["id"]]).total
    collateral = collateral_of(row, gold_rates(conn), today_owed)
    return allocations, changes, collateral.value if collateral else None


def baseline(conn: Connection, row: RowMapping, today: date) -> ProjectedSeries:
    """The Projection with no further Payments."""
    allocations, changes, value = _inputs(conn, row, today)
    return _series(row, allocations, changes, today, value, None)


router = APIRouter(prefix="/api")


@router.get("/mortgages/{mortgage_id}/projection")
def project(
    mortgage_id: int,
    engine: EngineDep,
    today: TodayDep,
    monthly_payment: Annotated[int | None, Query(gt=0)] = None,
) -> Projection:
    """Where the Mortgage is heading: with no more Payments, and with `monthly_payment`
    (paise) paid on every Accrual Date."""
    with engine.connect() as conn:
        row = mortgage_row(conn, mortgage_id)
        if row["status"] != MortgageStatus.ACTIVE:
            raise HTTPException(
                status.HTTP_409_CONFLICT, f"{row['name']} is {row['status']}"
            )
        allocations, changes, value = _inputs(conn, row, today)
    hypothetical = (
        HypotheticalPayments(after=today, amount=monthly_payment)
        if monthly_payment
        else None
    )
    return Projection(
        as_of=today,
        collateral_value=value,
        monthly_payment=monthly_payment,
        baseline=_series(row, allocations, changes, today, value, None),
        what_if=(
            _series(row, allocations, changes, today, value, hypothetical)
            if hypothetical
            else None
        ),
    )
