"""Advances (ADR 0021): the part of a Payment held for a Mortgage's interest for its next
few months, split into Advance Instalments, each an Allocation dated one of that
Mortgage's next Accrual Dates after the date received, and applied by Replay only once
its date arrives. What a Mortgage's upcoming Advance Instalments hold never exceeds its
Outstanding."""

from collections.abc import Sequence
from datetime import date
from typing import Literal

from pydantic import BaseModel
from sqlalchemy import insert, select
from sqlalchemy.engine import Connection, RowMapping

from mortgage_backend.lending.ledger import accrual_date
from mortgage_backend.lending.replay import replay
from mortgage_backend.platform.db import advance_instalment_table
from mortgage_backend.platform.errors import unprocessable
from mortgage_backend.platform.money import format_inr

MAX_MONTHS = 12


def split(advance: int, months: int) -> list[int]:
    """As equal as the paise allow: each part rounded down to the paisa, the last also
    taking the remainder, so they add up to the Advance."""
    part = advance // months
    return [part] * (months - 1) + [advance - part * (months - 1)]


def landing_dates(start: date, received_on: date, months: int) -> list[date]:
    """A Mortgage's next `months` Accrual Dates strictly after the date received."""
    n = 1
    while accrual_date(start, n) <= received_on:
        n += 1
    return [accrual_date(start, n + i) for i in range(months)]


def write_advance(
    conn: Connection,
    payment_id: int,
    mortgage: RowMapping,
    advance: int,
    months: int,
    received_on: date,
) -> None:
    """Write the Payment's Advance on `mortgage` as its Advance Instalments."""
    conn.execute(
        insert(advance_instalment_table),
        [
            {
                "payment_id": payment_id,
                "mortgage_id": mortgage["id"],
                "on": on,
                "amount": amount,
            }
            for on, amount in zip(
                landing_dates(mortgage["start_date"], received_on, months),
                split(advance, months),
                strict=True,
            )
        ],
    )


def refuse_overheld(
    conn: Connection, mortgage_id: int, advance: int, received_on: date
) -> None:
    """Refuse an Advance of `advance`, now written, if the Mortgage's upcoming Advance
    Instalments would hold more than its Outstanding on the date received, after the
    Payment's other Allocations and Discounts: a Closure could then overpay it."""
    mortgage = replay(conn, mortgage_id)
    owed = mortgage.outstanding(received_on).total
    held = sum(i.amount for i in mortgage.instalments() if i.on > received_on)
    if held > owed:
        fits = max(0, owed - (held - advance))
        raise unprocessable(
            f"{mortgage.row['name']}: an Advance of {format_inr(advance)} would hold "
            f"more than the {format_inr(owed)} it owes on {received_on:%d %b %Y}; "
            f"at most {format_inr(fits)} fits"
        )


class AdvancePart(BaseModel):
    """An Advance Instalment as Replay applies it on its date."""

    on: date
    amount: int
    interest: int  # the month's interest charged that day
    interest_paid: int  # unpaid interest, then the Interest to Date ahead
    principal_paid: int
    principal_after: int
    unpaid_interest_after: int


class AdvanceSchedule(BaseModel):
    """A Mortgage's Advance in a Payment, part by part, with every part in place.
    `reduces_principal`: a part pays Principal (a warning; it can still be saved);
    `falls_short`: some interest is still unpaid after a part; `exact`: neither."""

    parts: list[AdvancePart]
    verdict: Literal["exact", "falls_short", "reduces_principal"]


def advance_schedules(conn: Connection, payment_id: int) -> dict[int, AdvanceSchedule]:
    """The Payment's Advance on each Mortgage it holds one for, by Mortgage id, replayed
    up to its last part."""
    mortgage_ids = conn.execute(
        select(advance_instalment_table.c.mortgage_id)
        .where(advance_instalment_table.c.payment_id == payment_id)
        .distinct()
    ).scalars()
    return {
        mortgage_id: _schedule(conn, mortgage_id, payment_id)
        for mortgage_id in mortgage_ids
    }


def _schedule(conn: Connection, mortgage_id: int, payment_id: int) -> AdvanceSchedule:
    mortgage = replay(conn, mortgage_id)
    instalments = [i for i in mortgage.instalments() if i.payment_id == payment_id]
    ids = {i.instalment_id for i in instalments}
    ledger = mortgage.ledger(instalments[-1].on)
    interest = {s.on: s.amount for s in ledger if s.event == "interest"}
    parts = [
        AdvancePart(
            on=step.on,
            amount=step.amount,
            interest=interest.get(step.on, 0),
            interest_paid=step.interest_paid,
            principal_paid=step.principal_paid,
            principal_after=step.principal,
            unpaid_interest_after=step.unpaid_interest,
        )
        for step in ledger
        if step.instalment_id in ids
    ]
    return AdvanceSchedule(parts=parts, verdict=_verdict(parts))


def _verdict(
    parts: Sequence[AdvancePart],
) -> Literal["exact", "falls_short", "reduces_principal"]:
    if any(part.principal_paid for part in parts):
        return "reduces_principal"
    if any(part.unpaid_interest_after for part in parts):
        return "falls_short"
    return "exact"
