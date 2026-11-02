"""Closing a Mortgage: what it would take on a date, its Outstanding then.

Redeeming, Forfeiting and Reopening are changes, made in the changes module.
"""

from datetime import date

from fastapi import APIRouter

from mortgage_backend.lending.changes import closable
from mortgage_backend.lending.replay import OutstandingOnClosure
from mortgage_backend.platform.clock import TodayDep
from mortgage_backend.platform.db import EngineDep

router = APIRouter(prefix="/api")


@router.get("/mortgages/{mortgage_id}/outstanding-on-closure")
def outstanding_on_closure(
    mortgage_id: int, on: date, engine: EngineDep, today: TodayDep
) -> OutstandingOnClosure:
    """What it takes to close the Mortgage on `on`: its Outstanding then."""
    with engine.connect() as conn:
        mortgage = closable(conn, mortgage_id, on, today, quote_only=True)
        return mortgage.outstanding_on_closure(on)
