"""Advances (ADR 0021): the part of a Payment held for a Mortgage's interest for its next
few months, split into Advance Instalments, each an Allocation dated one of that
Mortgage's next Accrual Dates after the date received, and applied by Replay only once
its date arrives. What a Mortgage's upcoming Advance Instalments hold never exceeds its
Outstanding."""

from collections.abc import Mapping, Sequence
from datetime import date
from typing import Literal

from pydantic import BaseModel
from sqlalchemy import insert, select
from sqlalchemy.engine import Connection, RowMapping

from mortgage_backend.lending.ledger import (
    Allocation,
    LedgerStep,
    accrual_dates_after,
)
from mortgage_backend.lending.replay import MortgageReplay, replay
from mortgage_backend.payments.writes import AllocationIn
from mortgage_backend.platform.db import advance_instalment_table
from mortgage_backend.platform.errors import unprocessable
from mortgage_backend.platform.money import format_inr


def split(advance: int, months: int) -> list[int]:
    """As equal as the paise allow: each part rounded down to the paisa, the last also
    taking the remainder, so they add up to the Advance."""
    part = advance // months
    return [part] * (months - 1) + [advance - part * (months - 1)]


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
                # The Mortgage's next Accrual Dates strictly after the date received
                accrual_dates_after(mortgage["start_date"], received_on, months),
                split(advance, months),
                strict=True,
            )
        ],
    )


def _upcoming(mortgage: MortgageReplay, on: date) -> list[Allocation]:
    """Its Advance Instalments still upcoming on `on`, by date."""
    return [i for i in mortgage.instalments() if i.on > on]


def refuse_overheld(
    conn: Connection, allocation: AllocationIn, received_on: date, today: date
) -> None:
    """Refuse a Payment, now written, that leaves the Allocation's Mortgage with
    upcoming Advance Instalments holding more than it owes: a Closure could then
    overpay it. Its own Advance is checked on the date received; any other Payment or
    Discount against the parts still upcoming today, which are the ones the Lender can
    cancel. Names the most that fits, and the latest parts to cancel first."""
    on = received_on if allocation.advance else today
    mortgage = replay(conn, allocation.mortgage_id)
    owed = mortgage.outstanding(on).total
    upcoming = _upcoming(mortgage, on)
    held = sum(i.amount for i in upcoming)
    excess = held - owed
    if excess <= 0:
        return
    name = mortgage.row["name"]
    if allocation.advance:
        raise unprocessable(
            f"{name}: an Advance of {format_inr(allocation.advance)} would hold more "
            f"than the {format_inr(owed)} it owes on {on:%d %b %Y}; at most "
            f"{format_inr(max(0, allocation.advance - excess))} fits"
        )
    # Cancelling a part applies it at once, so the latest parts covering the excess
    # can pay that much of this Payment instead.
    cancel: list[Allocation] = []
    for part in reversed(upcoming):
        cancel.insert(0, part)
        if sum(i.amount for i in cancel) >= excess:
            break
    taking = allocation.amount + allocation.discount
    raise unprocessable(
        f"{name}: this would leave its upcoming Advance Instalments holding "
        f"{format_inr(held)}, more than the {format_inr(owed)} it would owe on "
        f"{on:%d %b %Y}. Take at most {format_inr(max(0, taking - excess))}, or "
        f"cancel the Advance Instalments on "
        f"{', '.join(f'{i.on:%d %b %Y}' for i in cancel)} first, which pay "
        f"{format_inr(sum(i.amount for i in cancel))} of it at once, and take that "
        f"much less"
    )


class AdvanceWarning(BaseModel):
    """An upcoming Advance Instalment that would reduce Principal after a change, or
    reduce it more: Replay sends what exceeds its month's interest to Principal."""

    on: date
    amount: int
    principal_paid: int  # after the change


def upcoming_parts(mortgage: MortgageReplay, today: date) -> dict[int, LedgerStep]:
    """Each Advance Instalment still upcoming on `today`, as Replay will apply it, by
    its id, in date order."""
    upcoming = _upcoming(mortgage, today)
    if not upcoming:
        return {}
    ids = {i.instalment_id for i in upcoming}
    return {
        step.instalment_id: step
        for step in mortgage.ledger(upcoming[-1].on)
        if step.instalment_id is not None and step.instalment_id in ids
    }


def advance_warnings(
    before: Mapping[int, LedgerStep], after: Mapping[int, LedgerStep]
) -> list[AdvanceWarning]:
    """The upcoming parts, there before a change, that would pay more Principal after
    it. A part the change adds is in its own Advance's schedule instead."""
    return [
        AdvanceWarning(
            on=step.on, amount=step.amount, principal_paid=step.principal_paid
        )
        for id_, step in after.items()
        if id_ in before and step.principal_paid > before[id_].principal_paid
    ]


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
