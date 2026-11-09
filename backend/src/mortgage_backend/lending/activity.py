"""Lending activity (ADR 0017): Principal lent, Principal redeemed and Interest
collected for a period, both inclusive. Non-Voided, cash only (ADR 0014)."""

from collections.abc import Mapping
from datetime import date

from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.engine import Connection

from mortgage_backend.lending.replay import MortgageReplay, replays
from mortgage_backend.platform.db import mortgage_table


class ActivityTotals(BaseModel):
    """Principal lent, Principal redeemed and Interest collected for a period (ADR
    0017): non-Voided, cash only (ADR 0014), inclusive dates."""

    principal_lent: int
    principal_redeemed: int
    interest_collected: int


def default_activity_range(today: date) -> tuple[date, date]:
    """The Dashboard's default activity timeframe: the current calendar month,
    decided in this one place."""
    return today.replace(day=1), today


def activity(
    replayed: Mapping[int, MortgageReplay], start: date, end: date
) -> ActivityTotals:
    """Principal lent, Principal redeemed and Interest collected between `start` and
    `end`, both inclusive (ADR 0017). Voided Payments are in no replay, and Discounts
    are non-cash (ADR 0014), so neither counts."""
    lent = redeemed = collected = 0
    for mortgage in replayed.values():
        if start <= mortgage.row["start_date"] <= end:
            lent += mortgage.row["amount_lent"]
        for step in mortgage.steps_by_payment(end).values():
            if start <= step.on:
                redeemed += step.principal_paid
                collected += step.interest_paid
    return ActivityTotals(
        principal_lent=lent, principal_redeemed=redeemed, interest_collected=collected
    )


def all_replays(conn: Connection) -> dict[int, MortgageReplay]:
    """Every Mortgage, replayed."""
    return replays(conn, conn.execute(select(mortgage_table)).mappings().all())
