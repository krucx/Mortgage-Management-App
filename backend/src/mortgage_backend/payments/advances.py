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

from mortgage_backend.lending.ledger import LedgerStep, accrual_date
from mortgage_backend.lending.replay import MortgageReplay, replay
from mortgage_backend.platform.db import advance_instalment_table
from mortgage_backend.platform.errors import unprocessable
from mortgage_backend.platform.money import format_inr


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
    conn: Connection, mortgage_id: int, on: date, taking: int, advance: int = 0
) -> None:
    """Refuse a Payment, now written, that leaves the Mortgage's Advance Instalments
    upcoming on `on` holding more than it owes then: a Closure could then overpay it.
    `taking` is what its Allocation pays the Mortgage (cash and Discount), `advance`
    its own Advance, if any. Name the most that fits, and for a Payment holding no
    Advance, the latest parts to cancel first."""
    mortgage = replay(conn, mortgage_id)
    owed = mortgage.outstanding(on).total
    upcoming = [i for i in mortgage.instalments() if i.on > on]
    held = sum(i.amount for i in upcoming)
    excess = held - owed
    if excess <= 0:
        return
    name = mortgage.row["name"]
    if advance:
        raise unprocessable(
            f"{name}: an Advance of {format_inr(advance)} would hold more than the "
            f"{format_inr(owed)} it owes on {on:%d %b %Y}; at most "
            f"{format_inr(max(0, advance - excess))} fits"
        )
    # Cancelling a part applies it at once, so the latest parts covering the excess
    # can pay it now instead of this.
    cancel: list[date] = []
    covered = 0
    for part in reversed(upcoming):
        cancel.insert(0, part.on)
        covered += part.amount
        if covered >= excess:
            break
    raise unprocessable(
        f"{name}: this would leave its upcoming Advance Instalments holding "
        f"{format_inr(held)}, more than the {format_inr(owed)} it would owe on "
        f"{on:%d %b %Y}; cancel the parts on "
        f"{', '.join(f'{d:%d %b %Y}' for d in cancel)} first, or take at most "
        f"{format_inr(max(0, taking - excess))}"
    )


class AdvanceWarning(BaseModel):
    """An upcoming Advance Instalment that a change would have reduce Principal (or
    reduce it more): Replay sends what exceeds its month's interest to Principal."""

    on: date
    amount: int
    principal_paid: int  # after the change


def upcoming_parts(mortgage: MortgageReplay, today: date) -> dict[int, LedgerStep]:
    """Each Advance Instalment still upcoming on `today`, as Replay will apply it, by
    its id, in date order."""
    upcoming = [i for i in mortgage.instalments() if i.on > today]
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
