"""A Collateral Value set by hand on a Mortgage, or cleared to value its jewellery at the
Gold Rate again."""

from datetime import date, datetime

from fastapi import APIRouter
from pydantic import BaseModel, Field
from sqlalchemy import update
from sqlalchemy.engine import Connection

from mortgage_backend.lending.mortgages import Mortgage, load_mortgage
from mortgage_backend.lending.refusals import refuse_unless_active
from mortgage_backend.lending.replay import mortgage_row
from mortgage_backend.platform.clock import NowDep, TodayDep
from mortgage_backend.platform.db import EngineDep, mortgage_table
from mortgage_backend.platform.errors import unprocessable
from mortgage_backend.safekeeping import audit

router = APIRouter(prefix="/api")


class CollateralIn(BaseModel):
    value: int | None = Field(default=None, gt=0)  # paise; None: the Gold Rate again


def set_collateral(
    conn: Connection, mortgage_id: int, value: int | None, today: date, now: datetime
) -> None:
    """Set the Collateral Value by hand, or clear it (None) to value the jewellery at
    the Gold Rate again; only while the jewellery is held (Active)."""
    before = mortgage_row(conn, mortgage_id)
    refuse_unless_active(before)
    if value is not None and value <= 0:
        raise unprocessable("A Collateral Value must be more than ₹0")
    conn.execute(
        update(mortgage_table)
        .where(mortgage_table.c.id == mortgage_id)
        .values(
            collateral_override=value,
            collateral_override_on=None if value is None else today,
        )
    )
    changed = audit.changes(
        before, {"collateral_override": value}, ["collateral_override"]
    )
    if changed:
        audit.record(conn, now, "mortgage", mortgage_id, "edited", changed)


@router.put("/mortgages/{mortgage_id}/collateral")
def put_collateral(
    mortgage_id: int,
    collateral: CollateralIn,
    engine: EngineDep,
    today: TodayDep,
    now: NowDep,
) -> Mortgage:
    """Set the Collateral Value by hand, or clear it to value at the Gold Rate again."""
    with engine.begin() as conn:
        set_collateral(conn, mortgage_id, collateral.value, today, now)
        return load_mortgage(conn, mortgage_id, today)
