"""The Dashboard: the whole lending book at a glance, and where it is heading.

Nothing here is stored: every figure is replayed from the Mortgages (ADR 0001) or added
up from the stored Payments. Looking ahead there are two kinds of figure: Projections
(exact: the Active Mortgages' Ledgers continued with no further Payments) and Trends
(estimates: the average of the last 3 full months carried forward, nothing cleverer).
"""

from datetime import date
from itertools import pairwise

from fastapi import APIRouter
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.engine import Connection

from mortgage_backend.call_list import call_list
from mortgage_backend.clock import TodayDep, month_span
from mortgage_backend.collateral import collateral_of, gold_rates
from mortgage_backend.db import EngineDep, mortgage_table, payment_table
from mortgage_backend.ledger import accrual_date
from mortgage_backend.money import RUPEE
from mortgage_backend.replay import MortgageReplay, MortgageStatus, replays

MONTHS_OF_PAYMENTS = 12
HORIZONS = (3, 6, 12)  # months ahead
TREND_MONTHS = 3
COMING_MONTHS = 12


class MonthlyPayments(BaseModel):
    month: str  # YYYY-MM
    amount: int  # paise: the Payments received that month, Voided ones left out


class ProjectionHorizon(BaseModel):
    months: int
    on: date
    interest_accrued: int  # exact: by the Active Mortgages, with no further Payments
    # Trend: the last 3 full months' average carried forward (estimates)
    payments_estimate: int
    principal_lent_estimate: int
    redemptions_estimate: float  # how many Mortgages


class ComingMonth(BaseModel):
    month: str  # YYYY-MM
    interest_charged: int  # exact: on the Active Mortgages' Accrual Dates that month
    payments_estimate: int  # the trend months' average


class Dashboard(BaseModel):
    as_of: date
    active_mortgages: int
    customers_with_active_mortgages: int
    principal_outstanding: int  # Active Mortgages
    unpaid_interest: int  # Active Mortgages
    interest_collected_this_month: int
    interest_collected_this_year: int
    collateral_value: int  # Active Mortgages that have one
    # Their Outstanding ÷ their Collateral Value; None if none has a value
    loan_to_value: float | None
    call_list_count: int  # Mortgages on today's Call List
    redeemed_this_month: int
    forfeited_this_month: int
    forfeiture_profit_loss_this_month: int  # Recovered Amount − Redemption Amount
    payments_by_month: list[MonthlyPayments]  # oldest first, this month last
    projections: list[ProjectionHorizon]  # 3, 6 and 12 months ahead
    trend_months: list[str]  # the full months the estimates average, YYYY-MM
    coming_months: list[ComingMonth]  # next month first, continuing payments_by_month


def _months_back(today: date, count: int) -> list[tuple[int, int]]:
    """The last `count` (year, month)s, oldest first, ending with this month's."""
    index = today.year * 12 + today.month - 1  # months since year 0, January = 0
    return [(i // 12, i % 12 + 1) for i in range(index - count + 1, index + 1)]


def _month(year: int, month: int) -> str:
    return f"{year}-{month:02d}"


class _Trend:
    """Totals over the last TREND_MONTHS full months, carried forward as averages."""

    def __init__(self, conn: Connection, today: date) -> None:
        self.months = _months_back(today, TREND_MONTHS + 1)[:-1]
        first = date(*self.months[0], 1)
        _, last = month_span(_month(*self.months[-1]))
        self.payments = conn.execute(
            select(func.coalesce(func.sum(payment_table.c.amount), 0)).where(
                payment_table.c.voided_at.is_(None),
                payment_table.c.paid_on.between(first, last),
            )
        ).scalar_one()
        self.principal_lent = conn.execute(
            select(func.coalesce(func.sum(mortgage_table.c.amount_lent), 0)).where(
                mortgage_table.c.start_date.between(first, last)
            )
        ).scalar_one()
        self.redemptions = conn.execute(
            select(func.count()).where(
                mortgage_table.c.status == MortgageStatus.REDEEMED,
                mortgage_table.c.closed_on.between(first, last),
            )
        ).scalar_one()

    def over(self, total: int, months: int) -> int:
        """`total` spread over `months` at the trend's rate, to the whole rupee (paise:
        an estimate claims no more precision than that)."""
        return round(total * months / TREND_MONTHS / RUPEE) * RUPEE


def _owed_on(active: list[MortgageReplay], dates: list[date]) -> dict[date, int]:
    """What the Active Mortgages will owe together at the end of each of `dates` (in
    order), with no further Payments."""
    owed = dict.fromkeys(dates, 0)
    for mortgage in active:
        for snapshot in mortgage.projection(dates).snapshots:
            owed[snapshot.on] += snapshot.principal + snapshot.unpaid_interest
    return owed


def _projections(
    conn: Connection, active: list[MortgageReplay], today: date
) -> tuple[list[ProjectionHorizon], list[str], list[ComingMonth]]:
    trend = _Trend(conn, today)
    horizons = {months: accrual_date(today, months) for months in HORIZONS}
    coming = _months_back(accrual_date(today, COMING_MONTHS), COMING_MONTHS)
    # Each month's end, starting with this one's: a month's interest is what is owed
    # more at its end than at the end of the month before.
    month_ends = [
        month_span(_month(*month))[1] for month in [(today.year, today.month), *coming]
    ]
    owed = _owed_on(active, sorted({today, *horizons.values(), *month_ends}))
    return (
        [
            ProjectionHorizon(
                months=months,
                on=on,
                interest_accrued=owed[on] - owed[today],
                payments_estimate=trend.over(trend.payments, months),
                principal_lent_estimate=trend.over(trend.principal_lent, months),
                redemptions_estimate=trend.redemptions * months / TREND_MONTHS,
            )
            for months, on in horizons.items()
        ],
        [_month(*month) for month in trend.months],
        [
            ComingMonth(
                month=_month(*month),
                interest_charged=owed[end] - owed[previous_end],
                payments_estimate=trend.over(trend.payments, 1),
            )
            for month, (previous_end, end) in zip(
                coming, pairwise(month_ends), strict=True
            )
        ],
    )


def _payments_by_month(conn: Connection, today: date) -> list[MonthlyPayments]:
    months = _months_back(today, MONTHS_OF_PAYMENTS)
    first_year, first_month = months[0]
    totals = dict.fromkeys(months, 0)
    for paid_on, amount in conn.execute(
        select(payment_table.c.paid_on, payment_table.c.amount).where(
            payment_table.c.voided_at.is_(None),
            payment_table.c.paid_on >= date(first_year, first_month, 1),
            payment_table.c.paid_on <= today,
        )
    ):
        totals[(paid_on.year, paid_on.month)] += amount
    return [
        MonthlyPayments(month=_month(year, month), amount=amount)
        for (year, month), amount in totals.items()
    ]


def dashboard(conn: Connection, today: date) -> Dashboard:
    rows = conn.execute(select(mortgage_table)).mappings().all()
    replayed = replays(conn, rows)
    rates = gold_rates(conn)
    this_month = (today.year, today.month)

    principal = unpaid = collected_month = collected_year = 0
    valued_owed = valued = 0
    active_customers = set()
    redeemed = forfeited = profit_loss = 0
    active: list[MortgageReplay] = []
    for row in rows:
        mortgage = replayed[row["id"]]
        ledger = mortgage.ledger(today)
        for step in ledger:
            if step.event == "payment" and step.on.year == today.year:
                collected_year += step.interest_paid
                if (step.on.year, step.on.month) == this_month:
                    collected_month += step.interest_paid
        if row["status"] == MortgageStatus.ACTIVE:
            owed = ledger[-1]
            principal += owed.principal
            unpaid += owed.unpaid_interest
            active_customers.add(row["customer_id"])
            active.append(mortgage)
            total = owed.principal + owed.unpaid_interest
            collateral = collateral_of(row, rates, total)
            if collateral:
                valued += collateral.value
                valued_owed += total
        elif (row["closed_on"].year, row["closed_on"].month) == this_month:
            if row["status"] == MortgageStatus.REDEEMED:
                redeemed += 1
            else:
                forfeited += 1
                owed_then = mortgage.redemption(row["closed_on"]).total
                profit_loss += row["recovered_amount"] - owed_then

    projections, trend_months, coming_months = _projections(conn, active, today)
    return Dashboard(
        as_of=today,
        active_mortgages=len(active),
        customers_with_active_mortgages=len(active_customers),
        principal_outstanding=principal,
        unpaid_interest=unpaid,
        interest_collected_this_month=collected_month,
        interest_collected_this_year=collected_year,
        collateral_value=valued,
        loan_to_value=valued_owed / valued if valued else None,
        call_list_count=sum(len(group.rows) for group in call_list(conn, today)),
        redeemed_this_month=redeemed,
        forfeited_this_month=forfeited,
        forfeiture_profit_loss_this_month=profit_loss,
        payments_by_month=_payments_by_month(conn, today),
        projections=projections,
        trend_months=trend_months,
        coming_months=coming_months,
    )


router = APIRouter(prefix="/api")


@router.get("/dashboard")
def read_dashboard(engine: EngineDep, today: TodayDep) -> Dashboard:
    with engine.connect() as conn:
        return dashboard(conn, today)
