"""Favours Given (see Documentation/GLOSSARY.md): every Discount and Waived Amount the
Lender has given a Customer across their Mortgages, still standing.

Nothing here is stored: a Voided Payment is in no replay, so its Discount is left out,
and a Reopened Waiver is Active again, so it has no Closure.
"""

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
    on: date  # the Payment's date, or the Closure date of a Waiver
    mortgage: FavourMortgage
    kind: Literal["discount", "waiver"]
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
    favours: list[Favour] = []
    for mortgage in replays(conn, rows).values():
        on_mortgage = FavourMortgage(
            id=mortgage.row["id"], description=mortgage.row["description"]
        )
        favours += [
            Favour(
                on=allocation.on,
                mortgage=on_mortgage,
                kind="discount",
                amount=allocation.discount,
            )
            for allocation in mortgage.allocations
            if allocation.discount
        ]
        closure = mortgage.closure()
        if closure is not None and closure.waived_amount:
            favours.append(
                Favour(
                    on=closure.on,
                    mortgage=on_mortgage,
                    kind="waiver",
                    amount=closure.waived_amount,
                )
            )
    favours.sort(key=lambda favour: favour.on, reverse=True)
    return FavoursGiven(
        favours=favours, total=sum(favour.amount for favour in favours)
    )


router = APIRouter(prefix="/api")


@router.get("/customers/{customer_id}/favours")
def read_favours_given(customer_id: int, engine: EngineDep) -> FavoursGiven:
    """Every Discount and Waived Amount still standing, newest first, with their total."""
    with engine.connect() as conn:
        if not exists(conn, customer_table, customer_id):
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Customer not found")
        return favours_given(conn, customer_id)
