"""Projections: a Mortgage's Ledger continued into the future (see GLOSSARY.md).

The ledger engine replays the Mortgage past today, with its coming Term Changes and,
for "what if", hypothetical Payments; there is no separate maths.
"""

from datetime import date
from typing import Annotated

from fastapi import APIRouter, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy.engine import Connection

from mortgage_backend.clock import TodayDep
from mortgage_backend.collateral import collateral_of, gold_rates
from mortgage_backend.db import EngineDep
from mortgage_backend.ledger import HypotheticalPayments, LedgerStep, accrual_date
from mortgage_backend.replay import MortgageReplay, MortgageStatus, replay
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


class ComingTermChange(BaseModel):
    on: date
    terms: Terms  # from then on


class ProjectedSeries(BaseModel):
    points: list[ProjectedPoint]  # today, then each month for a year
    term_changes: list[ComingTermChange]  # in the coming year
    paid_off_on: date | None  # within ten years, if ever


class Projection(BaseModel):
    as_of: date
    collateral_value: int | None
    monthly_payment: int | None
    baseline: ProjectedSeries  # no further Payments
    what_if: ProjectedSeries | None  # `monthly_payment` on every Accrual Date


def _series(
    mortgage: MortgageReplay,
    today: date,
    collateral_value: int | None,
    hypothetical: HypotheticalPayments | None,
) -> ProjectedSeries:
    def ledger(until: date) -> list[LedgerStep]:
        return mortgage.ledger(until, hypothetical)

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
                redemption_amount=mortgage.redemption(on, hypothetical).total,
                loan_to_value=owed / collateral_value if collateral_value else None,
            )
        )
    term_changes = [
        ComingTermChange(on=step.on, terms=step.terms)
        for step in ledger(points[-1].on)
        if step.on > today and step.event == "term_changed" and step.terms
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
    return ProjectedSeries(
        points=points, term_changes=term_changes, paid_off_on=paid_off_on
    )


def _collateral_value(
    conn: Connection, mortgage: MortgageReplay, today: date
) -> int | None:
    """Today's Collateral Value, which a Projection's Loan-to-Value is measured against."""
    owed = mortgage.outstanding(today).total
    collateral = collateral_of(mortgage.row, gold_rates(conn), owed)
    return collateral.value if collateral else None


def baseline(
    conn: Connection, mortgage: MortgageReplay, today: date
) -> ProjectedSeries:
    """The Projection with no further Payments."""
    return _series(mortgage, today, _collateral_value(conn, mortgage, today), None)


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
        mortgage = replay(conn, mortgage_id)
        row = mortgage.row
        if row["status"] != MortgageStatus.ACTIVE:
            raise HTTPException(
                status.HTTP_409_CONFLICT, f"{row['name']} is {row['status']}"
            )
        value = _collateral_value(conn, mortgage, today)
    hypothetical = (
        HypotheticalPayments(after=today, amount=monthly_payment)
        if monthly_payment
        else None
    )
    return Projection(
        as_of=today,
        collateral_value=value,
        monthly_payment=monthly_payment,
        baseline=_series(mortgage, today, value, None),
        what_if=(
            _series(mortgage, today, value, hypothetical) if hypothetical else None
        ),
    )
