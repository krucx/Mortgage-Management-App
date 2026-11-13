"""What a Payment writes and what it is refused for: the Payment's request shapes, its
rows and History, and Voiding it. Recording a Payment (Redeeming the Mortgages it pays
off) is in recording.py, which builds on the Closures in lending/closing.py, which
build on this."""

from collections.abc import Mapping
from datetime import date, datetime
from typing import NamedTuple

from fastapi import HTTPException, status
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import insert, select, update
from sqlalchemy.engine import Connection, RowMapping

from mortgage_backend.lending.refusals import check_replays, refuse_unless_active
from mortgage_backend.lending.replay import MortgageStatus, replay
from mortgage_backend.payments.grace_period import (
    GraceOffer,
    get_grace_period,
    grace_offers,
)
from mortgage_backend.payments.payments import PaymentMethod, mortgages_of
from mortgage_backend.platform.db import (
    allocation_table,
    customer_table,
    exists,
    mortgage_table,
    payment_table,
)
from mortgage_backend.platform.errors import unprocessable
from mortgage_backend.safekeeping import audit


class AllocationIn(BaseModel):
    mortgage_id: int
    amount: int = Field(ge=0)  # cash in paise
    discount: int = Field(default=0, ge=0)  # paise; applied after cash


class PaymentIn(BaseModel):
    customer_id: int
    paid_on: date
    # A Grace Payment's: when it was received, `paid_on` being the day before the
    # Accrual Date it is within the Grace Period of
    received_on: date | None = None
    amount: int = Field(ge=0)  # cash in paise
    method: PaymentMethod
    reference: str | None = None
    allocations: list[AllocationIn] = Field(min_length=1)

    @model_validator(mode="after")
    def allocations_add_up(self) -> "PaymentIn":
        if sum(allocation.amount for allocation in self.allocations) != self.amount:
            raise ValueError("Allocations must add up to the Payment amount")
        if not any(a.amount + a.discount for a in self.allocations):
            raise ValueError("A Payment must include cash or a Discount")
        if len({a.mortgage_id for a in self.allocations}) != len(self.allocations):
            raise ValueError("Each Mortgage can appear only once in a Payment")
        self.reference = (self.reference or "").strip() or None
        return self


class VoidIn(BaseModel):
    reason: str = Field(min_length=1)

    @model_validator(mode="after")
    def tidy(self) -> "VoidIn":
        self.reason = self.reason.strip()
        if not self.reason:
            raise ValueError("A reason is needed")
        return self


class Grace(NamedTuple):
    """A Grace Payment's received date, and what it lets off on each Mortgage, by id."""

    received_on: date
    let_off: Mapping[int, int]


def write_payment(
    conn: Connection,
    payment: PaymentIn,
    received_with: int | None = None,
    grace: Grace | None = None,
) -> int:
    """Write the Payment, or a part of one: `received_with` is the Payment's first part,
    whose Receipt the part shares. A Grace Payment keeps its `grace`."""
    payment_id: int = conn.execute(
        insert(payment_table)
        .values(
            **payment.model_dump(exclude={"allocations"}),
            received_with=received_with,
        )
        .returning(payment_table.c.id)
    ).scalar_one()
    conn.execute(
        insert(allocation_table),
        [
            {
                "payment_id": payment_id,
                **a.model_dump(),
                "let_off": grace.let_off[a.mortgage_id] if grace else None,
            }
            for a in payment.allocations
        ],
    )
    return payment_id


def record_payment_history(
    conn: Connection, payment_id: int, payment: PaymentIn, now: datetime
) -> None:
    audit.record(
        conn,
        now,
        "payment",
        payment_id,
        "created",
        audit.created(
            {**payment.model_dump(), "method": payment.method.value},
            ["paid_on", "received_on", "amount", "method", "reference"],
        ),
    )


def write_void(conn: Connection, payment_id: int, reason: str, now: datetime) -> None:
    conn.execute(
        update(payment_table)
        .where(payment_table.c.id == payment_id)
        .values(voided_at=now, void_reason=reason)
    )


def record_void_history(
    conn: Connection, payment_id: int, reason: str, now: datetime
) -> None:
    audit.record(
        conn,
        now,
        "payment",
        payment_id,
        "voided",
        [audit.Change("void_reason", None, reason)],
    )


def refuse_payment(
    conn: Connection, payment: PaymentIn, today: date
) -> list[RowMapping]:
    """The Mortgages the Payment is allocated to, unless it cannot be made at all."""
    if payment.paid_on > today:
        raise unprocessable("The Payment date cannot be in the future")
    if not exists(conn, customer_table, payment.customer_id):
        raise unprocessable("Customer not found")
    rows = []
    for allocation in payment.allocations:
        row = (
            conn.execute(
                select(mortgage_table).where(
                    mortgage_table.c.id == allocation.mortgage_id
                )
            )
            .mappings()
            .first()
        )
        if row is None or row["customer_id"] != payment.customer_id:
            raise unprocessable("Each Mortgage must belong to the paying Customer")
        refuse_unless_active(row)
        if payment.paid_on < row["start_date"]:
            raise unprocessable(f"{row['name']} had not started on that date")
        rows.append(row)
    return rows


def grace_offers_for(
    conn: Connection, payment: PaymentIn, received_on: date
) -> list[GraceOffer]:
    """The Grace `payment` may have had it been received on `received_on`, under the
    Grace Period as it is set now: none if that is not within it, or if any of its
    Mortgages is not Active."""
    mortgages = [replay(conn, a.mortgage_id) for a in payment.allocations]
    if any(m.row["status"] != MortgageStatus.ACTIVE for m in mortgages):
        return []
    return grace_offers(
        mortgages,
        {a.mortgage_id: a.amount + a.discount for a in payment.allocations},
        received_on,
        get_grace_period(conn).grace_period_days,
    )


def payment_grace(conn: Connection, payment: PaymentIn, today: date) -> Grace | None:
    """A Grace Payment's received date and what it lets off on each Mortgage, as
    worked out now (ADR 0020); refused unless its dates fit the Grace Period as it is
    set now and it lets off something. None for any other Payment."""
    received_on = payment.received_on
    if received_on is None:
        return None
    if received_on > today:
        raise unprocessable("The date received cannot be in the future")
    offer = next(
        (
            offer
            for offer in grace_offers_for(conn, payment, received_on)
            if offer.paid_on == payment.paid_on
        ),
        None,
    )
    if offer is None:
        raise unprocessable(
            f"A Payment received on {received_on:%d %b %Y} can't be dated "
            f"{payment.paid_on:%d %b %Y}: that is not within the Grace Period"
        )
    if offer.let_off == 0:
        raise unprocessable(
            f"Dating it {payment.paid_on:%d %b %Y} lets off nothing: record it as "
            "an ordinary Payment"
        )
    return Grace(received_on, {m.mortgage_id: m.let_off for m in offer.mortgages})


def void_payment(
    conn: Connection, payment_id: int, reason: str, today: date, now: datetime
) -> None:
    """Void a Payment (or refuse): a Redemption's final Payment, or one to a closed
    Mortgage, is Voided by reopening instead."""
    # Read straight from the table: loading the Payment would replay its Mortgages,
    # which Reopening has just made Active with its final Payment still in place.
    found = conn.execute(
        select(payment_table.c.voided_at).where(payment_table.c.id == payment_id)
    ).one_or_none()
    if found is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Payment not found")
    if found.voided_at is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "Already voided")
    rows = mortgages_of(conn, payment_id)
    for row in rows:
        if row["redemption_payment_id"] == payment_id:
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                f"This is the final Payment of the closing of {row['name']}: "
                "reopen the Mortgage instead, which voids it",
            )
        refuse_unless_active(row)
    write_void(conn, payment_id, reason, now)
    check_replays(conn, rows, today)
    record_void_history(conn, payment_id, reason, now)
