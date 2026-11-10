"""Favours Given (see Documentation/GLOSSARY.md): every Grace, Discount and Waived Amount
the Lender has given a Customer across their Mortgages, still standing.

Discounts and Waived Amounts are read from the replays: a Voided Payment is in no
replay, so its Discount is left out, and a Reopened Waiver is Active again, so it has
no Closure. What a Grace Payment let off is stored (ADR 0020), so it is read as saved,
leaving out Voided Payments (a Reopened Redemption's final Payment among them).
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
    allocation_table,
    customer_table,
    exists,
    mortgage_table,
    payment_table,
)


class FavourMortgage(BaseModel):
    """The Mortgage a favour was given on, by its description (as the Customer knows it)."""

    id: int
    description: str


class Favour(BaseModel):
    on: date  # the Payment's date, or the Closure date of a Waived Mortgage
    received_on: date | None  # a Grace's: when its Payment was received, after `on`
    mortgage: FavourMortgage
    kind: Literal["grace", "discount", "waived"]
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
    given_on = {
        row["id"]: FavourMortgage(id=row["id"], description=row["description"])
        for row in rows
    }
    # Each favour with the Payment that gave it, to order those given on one day: a
    # Waived Amount comes with its final Payment, or, with nothing paid, after them all.
    given = [
        (
            graced.payment_id,
            Favour(
                on=graced.paid_on,
                received_on=graced.received_on,
                mortgage=given_on[graced.mortgage_id],
                kind="grace",
                amount=graced.let_off,
            ),
        )
        for graced in conn.execute(
            select(
                allocation_table.c.payment_id,
                allocation_table.c.mortgage_id,
                allocation_table.c.let_off,
                payment_table.c.paid_on,
                payment_table.c.received_on,
            )
            .join(payment_table, payment_table.c.id == allocation_table.c.payment_id)
            .where(
                allocation_table.c.mortgage_id.in_(given_on),
                allocation_table.c.let_off > 0,
                payment_table.c.voided_at.is_(None),
            )
        )
    ]
    for mortgage in replays(conn, rows).values():
        given += [
            (
                allocation.payment_id,
                Favour(
                    on=allocation.on,
                    received_on=None,
                    mortgage=given_on[mortgage.row["id"]],
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
                        received_on=None,
                        mortgage=given_on[mortgage.row["id"]],
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
    """Every Grace, Discount and Waived Amount still standing, newest first, with their
    total."""
    with engine.connect() as conn:
        if not exists(conn, customer_table, customer_id):
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Customer not found")
        return favours_given(conn, customer_id)
