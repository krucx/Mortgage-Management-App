"""The Dashboard: the whole lending book at a glance.

Nothing here is stored: every figure is replayed from the Mortgages (ADR 0001) or added
up from the stored Payments.
"""

from datetime import date

from fastapi import APIRouter
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.engine import Connection

from mortgage_backend.call_list import call_list
from mortgage_backend.clock import TodayDep
from mortgage_backend.collateral import collateral_of, gold_rates
from mortgage_backend.db import EngineDep, mortgage_table, payment_table
from mortgage_backend.replay import MortgageStatus, replays

MONTHS_OF_PAYMENTS = 12


class MonthlyPayments(BaseModel):
    month: str  # YYYY-MM
    amount: int  # paise: the Payments received that month, Voided ones left out


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


def _months_back(today: date, count: int) -> list[tuple[int, int]]:
    """The last `count` (year, month)s, oldest first, ending with this month's."""
    index = today.year * 12 + today.month - 1  # months since year 0, January = 0
    return [(i // 12, i % 12 + 1) for i in range(index - count + 1, index + 1)]


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
        MonthlyPayments(month=f"{year}-{month:02d}", amount=amount)
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

    return Dashboard(
        as_of=today,
        active_mortgages=sum(r["status"] == MortgageStatus.ACTIVE for r in rows),
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
    )


router = APIRouter(prefix="/api")


@router.get("/dashboard")
def read_dashboard(engine: EngineDep, today: TodayDep) -> Dashboard:
    with engine.connect() as conn:
        return dashboard(conn, today)
