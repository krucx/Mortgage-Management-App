"""Closing a Mortgage: what Redemption would take, and what is waiting to be Redeemed.

Redeeming, Forfeiting and Reopening are changes, made in the changes module.
"""

from datetime import date

from fastapi import APIRouter
from pydantic import BaseModel

from mortgage_backend.changes import closable
from mortgage_backend.clock import TodayDep
from mortgage_backend.db import EngineDep, mortgage_table
from mortgage_backend.mortgages import MortgageRow, mortgage_rows, select_with_customer
from mortgage_backend.replay import MortgageStatus, Redemption, replays


class ReadyToRedeem(BaseModel):
    """An Active Mortgage with nothing Outstanding: the jewellery is waiting to go back."""

    mortgage: MortgageRow
    redemption: Redemption  # redeeming today; may include a Part-Month Rule charge


router = APIRouter(prefix="/api")


@router.get("/mortgages/{mortgage_id}/redemption")
def redemption_amount(
    mortgage_id: int, on: date, engine: EngineDep, today: TodayDep
) -> Redemption:
    """What it takes to redeem the Mortgage on `on`."""
    with engine.connect() as conn:
        return closable(conn, mortgage_id, on, today, quote_only=True).redemption(on)


@router.get("/closures/ready-to-redeem")
def ready_to_redeem(engine: EngineDep, today: TodayDep) -> list[ReadyToRedeem]:
    """Active Mortgages paid down to nothing Outstanding, oldest first."""
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
        listed = mortgage_rows(conn, rows, today)
        replayed = replays(conn, rows)
        return [
            ReadyToRedeem(
                mortgage=mortgage, redemption=replayed[mortgage.id].redemption(today)
            )
            for mortgage in listed
            if mortgage.outstanding_total == 0
        ]
