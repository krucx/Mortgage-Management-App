"""Closing a Mortgage: what it would take on a date, its Outstanding then, and which
Mortgages are Dormant, owing nothing with their jewellery still held.

Redeeming, Forfeiting and Reopening are changes, made in the changes module.
"""

from collections.abc import Callable
from datetime import date
from typing import Any, Literal

from fastapi import APIRouter

from mortgage_backend.lending.changes import closable
from mortgage_backend.lending.mortgages import (
    MortgageRow,
    mortgage_rows,
    select_with_customer,
)
from mortgage_backend.lending.replay import (
    MortgageStatus,
    OutstandingOnClosure,
    replays,
)
from mortgage_backend.platform.clock import TodayDep
from mortgage_backend.platform.db import EngineDep, mortgage_table
from mortgage_backend.platform.paging import Page, PageNumber, rows_page

router = APIRouter(prefix="/api")


@router.get("/mortgages/{mortgage_id}/outstanding-on-closure")
def outstanding_on_closure(
    mortgage_id: int, on: date, engine: EngineDep, today: TodayDep
) -> OutstandingOnClosure:
    """What it takes to close the Mortgage on `on`: its Outstanding then."""
    with engine.connect() as conn:
        mortgage = closable(conn, mortgage_id, on, today, quote_only=True)
        return mortgage.outstanding_on_closure(on)


# A column of the Dormant list to sort it by.
DormantSort = Literal["mortgage", "customer"]

_SORT_KEYS: dict[DormantSort, Callable[[MortgageRow], Any]] = {
    "mortgage": lambda row: row.name.casefold(),
    "customer": lambda row: row.customer.name.casefold(),
}


@router.get("/closures/dormant")
def dormant(
    engine: EngineDep,
    today: TodayDep,
    page: PageNumber = 1,
    sort: DormantSort | None = None,
    descending: bool = False,
) -> Page[MortgageRow]:
    """Dormant Mortgages, Active yet owing nothing today, oldest first (or by `sort`,
    reversed when `descending`)."""
    with engine.connect() as conn:
        rows = (
            conn.execute(
                select_with_customer()
                .where(mortgage_table.c.status == MortgageStatus.ACTIVE)
                .order_by(mortgage_table.c.start_date, mortgage_table.c.id)
            )
            .mappings()
            .all()
        )
        replayed = replays(conn, rows)
        listed = mortgage_rows(
            conn, [r for r in rows if replayed[r["id"]].dormant(today)], today, replayed
        )
    return rows_page(listed, page, _SORT_KEYS, sort=sort, descending=descending)
