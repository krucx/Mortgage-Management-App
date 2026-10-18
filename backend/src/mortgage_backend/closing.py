"""Closing a Mortgage: what Redemption would take, and what is waiting to be Redeemed.

Redeeming, Forfeiting and Reopening are changes, made in the changes module.
"""

from collections.abc import Callable
from datetime import date
from typing import Any, Literal

from fastapi import APIRouter
from pydantic import BaseModel

from mortgage_backend.changes import closable
from mortgage_backend.clock import TodayDep
from mortgage_backend.db import EngineDep, mortgage_table
from mortgage_backend.mortgages import MortgageRow, mortgage_rows, select_with_customer
from mortgage_backend.paging import Page, PageNumber, rows_page
from mortgage_backend.replay import MortgageStatus, Redemption, replays


class ReadyToRedeem(BaseModel):
    """An Active Mortgage with nothing Outstanding: the jewellery is waiting to go back."""

    mortgage: MortgageRow
    redemption: Redemption  # redeeming today; may include a Part-Month Rule charge


# A column of the Ready to Redeem list to sort it by.
ReadySort = Literal["mortgage", "customer", "amount"]

_SORT_KEYS: dict[ReadySort, Callable[[ReadyToRedeem], Any]] = {
    "mortgage": lambda ready: ready.mortgage.name.casefold(),
    "customer": lambda ready: ready.mortgage.customer.name.casefold(),
    "amount": lambda ready: ready.redemption.total,
}


router = APIRouter(prefix="/api")


@router.get("/mortgages/{mortgage_id}/redemption")
def redemption_amount(
    mortgage_id: int, on: date, engine: EngineDep, today: TodayDep
) -> Redemption:
    """What it takes to redeem the Mortgage on `on`."""
    with engine.connect() as conn:
        return closable(conn, mortgage_id, on, today, quote_only=True).redemption(on)


@router.get("/closures/ready-to-redeem")
def ready_to_redeem(
    engine: EngineDep,
    today: TodayDep,
    page: PageNumber = 1,
    sort: ReadySort | None = None,
    descending: bool = False,
) -> Page[ReadyToRedeem]:
    """Active Mortgages paid down to nothing Outstanding, oldest first (or by `sort`,
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
        listed = mortgage_rows(conn, rows, today, replayed)
        ready = [
            ReadyToRedeem(
                mortgage=mortgage, redemption=replayed[mortgage.id].redemption(today)
            )
            for mortgage in listed
            if mortgage.outstanding_total == 0
        ]
    return rows_page(ready, page, _SORT_KEYS, sort=sort, descending=descending)
