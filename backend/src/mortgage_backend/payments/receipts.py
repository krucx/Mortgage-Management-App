"""Receipts (see Documentation/GLOSSARY.md): what a Payment did, to send on WhatsApp or print.

Worked out from the Replay whenever asked, so a Receipt can be reopened and resent
later and still shows each Mortgage as it stood just after the Payment.
"""

from datetime import date

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import or_, select
from sqlalchemy.engine import Connection, RowMapping

from mortgage_backend.follow_up.message_settings import MESSAGE_SETTINGS
from mortgage_backend.follow_up.messages import (
    AdvanceAppliedMessage,
    ReceiptLine,
    ReceiptMessage,
    ReceiptPart,
    advance_applied_text,
    descriptions,
    receipt_text,
)
from mortgage_backend.lending.replay import mortgage_row, replay, replays
from mortgage_backend.payments.payments import METHOD_NAMES, PaymentMethod, mortgages_of
from mortgage_backend.people.customers import PersonSummary, phones_of
from mortgage_backend.platform.db import (
    EngineDep,
    advance_instalment_table,
    customer_table,
    payment_table,
)


class ReceiptLineOut(ReceiptLine):
    mortgage_id: int  # for the Lender's links; never shown to the Customer


class Receipt(BaseModel):
    payment_id: int
    customer: PersonSummary
    phones: list[str]  # the Customer's numbers, primary first
    paid_on: date
    received_on: date | None  # a Grace Payment's, after `paid_on`
    amount: int
    method: str
    reference: str | None
    lines: list[ReceiptLineOut]
    total_owed: int  # by the Mortgages it paid, after it
    text: str  # the WhatsApp message, from the Lender's Receipt template
    # A cancelled Advance Instalment's own date: its Receipt says what its amount paid
    # on `paid_on`, the date cancelled, and is not from the template
    advance_due_on: date | None


def _payment(conn: Connection, payment_id: int) -> RowMapping:
    """The Payment, with its Customer's name and numbers; refused once Voided."""
    payment = (
        conn.execute(
            select(
                payment_table,
                customer_table.c.name,
                customer_table.c.phone_1,
                customer_table.c.phone_2,
            )
            .join(customer_table, customer_table.c.id == payment_table.c.customer_id)
            .where(payment_table.c.id == payment_id)
        )
        .mappings()
        .first()
    )
    if payment is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Payment not found")
    if payment["voided_at"] is not None:
        raise HTTPException(
            status.HTTP_409_CONFLICT, "This Payment was Voided: it has no Receipt"
        )
    return payment


def load_receipt(conn: Connection, payment_id: int) -> Receipt:
    payment = _payment(conn, payment_id)
    # The parts of the Payment this one is part of (its Final Payments kept apart), which
    # share one Receipt.
    first = payment["received_with"] or payment_id
    together = (
        conn.execute(
            select(payment_table.c.id, payment_table.c.amount)
            .where(
                or_(
                    payment_table.c.id == first, payment_table.c.received_with == first
                ),
                payment_table.c.voided_at.is_(None),
            )
            .order_by(payment_table.c.id)
        )
        .mappings()
        .all()
    )
    allocated = [(p["id"], m) for p in together for m in mortgages_of(conn, p["id"])]
    mortgages = [mortgage for _, mortgage in allocated]
    replayed = replays(conn, mortgages)
    # Each Mortgage once: one paid in two parts isn't two pieces described alike.
    described = descriptions(list({m["id"]: m for m in mortgages}.values()))
    amount = sum(p["amount"] for p in together)
    # Each Advance as it was received, cancelled parts too.
    advance_parts: dict[int, list[ReceiptPart]] = {}
    for part in conn.execute(
        select(advance_instalment_table)
        .where(advance_instalment_table.c.payment_id.in_([p["id"] for p in together]))
        .order_by(advance_instalment_table.c.on, advance_instalment_table.c.id)
    ).mappings():
        advance_parts.setdefault(part["mortgage_id"], []).append(
            ReceiptPart(on=part["on"], amount=part["amount"])
        )
    # One line a Mortgage: a part paying what it owed and its Final Payment, together.
    lines: dict[int, ReceiptLineOut] = {}
    for paid_by, mortgage in allocated:
        step = replayed[mortgage["id"]].steps_by_payment()[paid_by]
        # A Waiver's final Payment leaves nothing owed: the rest was let off with it.
        closure = replayed[mortgage["id"]].closure()
        # How the Mortgage closed, when this Allocation was its final Payment.
        closed_by = closure.kind if closure and closure.payment_id == paid_by else None
        waived = closed_by == "waived"
        line = ReceiptLineOut(
            description=described[mortgage["id"]],
            mortgage_id=mortgage["id"],
            paid=mortgage["allocated"],
            discount=mortgage["discount"],
            interest_paid=step.interest_paid,
            principal_paid=step.principal_paid,
            discount_interest_paid=step.discount_interest_paid,
            discount_principal_paid=step.discount_principal_paid,
            owed_after=0
            if waived
            else replayed[mortgage["id"]].owed_after(paid_by, payment["paid_on"]),
            redeemed=closed_by == "redeemed",
            let_off=mortgage["let_off"] or 0,
            advance_parts=advance_parts.get(mortgage["id"], []),
        )
        earlier = lines.get(mortgage["id"])
        if earlier is not None:
            line = line.model_copy(
                update={
                    "paid": earlier.paid + line.paid,
                    "discount": earlier.discount + line.discount,
                    "interest_paid": earlier.interest_paid + line.interest_paid,
                    "principal_paid": earlier.principal_paid + line.principal_paid,
                    "discount_interest_paid": (
                        earlier.discount_interest_paid + line.discount_interest_paid
                    ),
                    "discount_principal_paid": (
                        earlier.discount_principal_paid + line.discount_principal_paid
                    ),
                    "redeemed": earlier.redeemed or line.redeemed,
                    "let_off": earlier.let_off + line.let_off,
                }
            )
        lines[mortgage["id"]] = line
    method = METHOD_NAMES[PaymentMethod(payment["method"])]
    message = ReceiptMessage(
        customer_name=payment["name"],
        paid_on=payment["paid_on"],
        received_on=payment["received_on"],
        amount=amount,
        method=method,
        reference=payment["reference"],
        lines=list(lines.values()),
    )
    return Receipt(
        payment_id=payment_id,
        customer=PersonSummary(
            kind="customer", id=payment["customer_id"], name=payment["name"]
        ),
        phones=phones_of(payment),
        paid_on=payment["paid_on"],
        received_on=payment["received_on"],
        amount=amount,
        method=method,
        reference=payment["reference"],
        lines=list(lines.values()),
        total_owed=message.total_owed,
        text=receipt_text(MESSAGE_SETTINGS.get(conn).receipt_template, message),
        advance_due_on=None,
    )


def load_advance_receipt(
    conn: Connection, payment_id: int, instalment_id: int
) -> Receipt:
    """The Receipt for the Payment's Advance Instalment `instalment_id`, once cancelled:
    what its amount paid on the date cancelled."""
    payment = _payment(conn, payment_id)
    instalment = (
        conn.execute(
            select(advance_instalment_table).where(
                advance_instalment_table.c.id == instalment_id,
                advance_instalment_table.c.payment_id == payment_id,
                advance_instalment_table.c.cancelled_on.is_not(None),
            )
        )
        .mappings()
        .first()
    )
    if instalment is None:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND, "No cancelled Advance Instalment of this Payment"
        )
    row = mortgage_row(conn, instalment["mortgage_id"])
    mortgage = replay(conn, row["id"])
    applied_on = instalment["cancelled_on"]
    [step] = [
        s for s in mortgage.ledger(applied_on) if s.instalment_id == instalment_id
    ]
    line = ReceiptLineOut(
        description=descriptions([row])[row["id"]],
        mortgage_id=row["id"],
        paid=instalment["amount"],
        interest_paid=step.interest_paid,
        principal_paid=step.principal_paid,
        owed_after=mortgage.owed_after(payment_id, applied_on, instalment_id),
    )
    return Receipt(
        payment_id=payment_id,
        customer=PersonSummary(
            kind="customer", id=payment["customer_id"], name=payment["name"]
        ),
        phones=phones_of(payment),
        paid_on=applied_on,
        received_on=None,
        amount=instalment["amount"],
        method=METHOD_NAMES[PaymentMethod(payment["method"])],
        reference=payment["reference"],
        lines=[line],
        total_owed=line.owed_after,
        text=advance_applied_text(
            AdvanceAppliedMessage(
                customer_name=payment["name"],
                received_on=payment["received_on"] or payment["paid_on"],
                due_on=instalment["on"],
                applied_on=applied_on,
                line=line,
            )
        ),
        advance_due_on=instalment["on"],
    )


router = APIRouter(prefix="/api")


@router.get("/payments/{payment_id}/receipt")
def read_receipt(payment_id: int, engine: EngineDep) -> Receipt:
    with engine.connect() as conn:
        return load_receipt(conn, payment_id)


@router.get("/payments/{payment_id}/advance-instalments/{instalment_id}/receipt")
def read_advance_receipt(
    payment_id: int, instalment_id: int, engine: EngineDep
) -> Receipt:
    with engine.connect() as conn:
        return load_advance_receipt(conn, payment_id, instalment_id)
