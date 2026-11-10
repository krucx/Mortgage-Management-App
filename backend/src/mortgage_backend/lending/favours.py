"""Favours Given (see Documentation/GLOSSARY.md): every Discount and Waived Amount the
Lender has given a Customer across their Mortgages, still standing. Grace joins them
later.

Nothing here is stored: a Voided Payment is in no replay, so its Discount is left out,
and a Reopened Waiver is Active again, so it has no Closure.
"""

import sys
from datetime import date
from typing import Literal

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.engine import Connection

from mortgage_backend.lending.replay import replays
from mortgage_backend.platform.db import (
    EngineDep,
    customer_table,
    exists,
    mortgage_table,
)


class FavourMortgage(BaseModel):
    """The Mortgage a favour was given on, by its description (as the Customer knows it)."""

    id: int
    description: str


class Favour(BaseModel):
    on: date  # the Payment's date, or the Closure date of a Waived Mortgage
    mortgage: FavourMortgage
    kind: Literal["discount", "waived"]
    amount: int  # paise let off


class FavoursGiven(BaseModel):
    favours: list[Favour]  # newest first
    total: int


def favours_given(conn: Connection, customer_id: int) -> FavoursGiven:
    rows = (
        conn.execute(
            select(mortgage_table).where(mortgage_table.c.customer_id == customer_id)
        )
        .mappings()
        .all()
    )
    # Each favour with the Payment that gave it, to order those given on one day: a
    # Waived Amount comes with its final Payment, or, with nothing paid, after them all.
    given: list[tuple[int, Favour]] = []
    for mortgage in replays(conn, rows).values():
        given_on = FavourMortgage(
            id=mortgage.row["id"], description=mortgage.row["description"]
        )
        given += [
            (
                allocation.payment_id,
                Favour(
                    on=allocation.on,
                    mortgage=given_on,
                    kind="discount",
                    amount=allocation.discount,
                ),
            )
            for allocation in mortgage.allocations
            if allocation.discount
        ]
        closure = mortgage.closure()
        if closure is not None and closure.waived_amount:
            given.append(
                (
                    closure.payment_id or sys.maxsize,
                    Favour(
                        on=closure.on,
                        mortgage=given_on,
                        kind="waived",
                        amount=closure.waived_amount,
                    ),
                )
            )
    given.sort(key=lambda pair: (pair[1].on, pair[0]), reverse=True)  # newest first
    favours = [favour for _, favour in given]
    return FavoursGiven(
        favours=favours, total=sum(favour.amount for favour in favours)
    )


router = APIRouter(prefix="/api")


@router.get("/customers/{customer_id}/favours")
def read_favours_given(customer_id: int, engine: EngineDep) -> FavoursGiven:
    """Every Discount and Waived Amount still standing, newest first, with their total
    (Grace joins them later)."""
    with engine.connect() as conn:
        if not exists(conn, customer_table, customer_id):
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Customer not found")
        return favours_given(conn, customer_id)
