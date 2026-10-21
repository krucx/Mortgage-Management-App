"""Receipts (see GLOSSARY.md): what a Payment did, to send on WhatsApp or print.

Worked out from the Replay whenever asked, so a Receipt can be reopened and resent
later and still shows each Mortgage as it stood just after the Payment.
"""

from datetime import date

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.engine import Connection

from mortgage_backend.follow_up.message_settings import MESSAGE_SETTINGS
from mortgage_backend.follow_up.messages import (
    ReceiptLine,
    ReceiptMessage,
    descriptions,
    receipt_text,
)
from mortgage_backend.lending.replay import replays
from mortgage_backend.payments.payments import METHOD_NAMES, PaymentMethod, mortgages_of
from mortgage_backend.people.customers import PersonSummary, phones_of
from mortgage_backend.platform.db import EngineDep, customer_table, payment_table


class ReceiptLineOut(ReceiptLine):
    mortgage_id: int  # for the Lender's links; never shown to the Customer


class Receipt(BaseModel):
    payment_id: int
    customer: PersonSummary
    phones: list[str]  # the Customer's numbers, primary first
    paid_on: date
    amount: int
    method: str
    reference: str | None
    lines: list[ReceiptLineOut]
    total_owed: int  # by the Mortgages it paid, after it
    text: str  # the WhatsApp message, from the Lender's Receipt template


def load_receipt(conn: Connection, payment_id: int) -> Receipt:
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
    mortgages = mortgages_of(conn, payment_id)
    replayed = replays(conn, mortgages)
    described = descriptions(mortgages)
    lines = []
    for mortgage in mortgages:
        step = replayed[mortgage["id"]].steps_by_payment()[payment_id]
        # A Waiver's final Payment leaves nothing owed: the rest was let off with it.
        closure = replayed[mortgage["id"]].closure()
        waived = (
            closure is not None
            and closure.kind == "waived"
            and closure.payment_id == payment_id
        )
        lines.append(
            ReceiptLineOut(
                description=described[mortgage["id"]],
                mortgage_id=mortgage["id"],
                paid=mortgage["allocated"],
                interest_paid=step.interest_paid,
                principal_paid=step.principal_paid,
                owed_after=0 if waived else step.principal + step.unpaid_interest,
            )
        )
    method = METHOD_NAMES[PaymentMethod(payment["method"])]
    message = ReceiptMessage(
        customer_name=payment["name"],
        paid_on=payment["paid_on"],
        amount=payment["amount"],
        method=method,
        reference=payment["reference"],
        lines=lines,
    )
    return Receipt(
        payment_id=payment_id,
        customer=PersonSummary(
            kind="customer", id=payment["customer_id"], name=payment["name"]
        ),
        phones=phones_of(payment),
        paid_on=payment["paid_on"],
        amount=payment["amount"],
        method=method,
        reference=payment["reference"],
        lines=lines,
        total_owed=message.total_owed,
        text=receipt_text(MESSAGE_SETTINGS.get(conn).receipt_template, message),
    )


router = APIRouter(prefix="/api")


@router.get("/payments/{payment_id}/receipt")
def read_receipt(payment_id: int, engine: EngineDep) -> Receipt:
    with engine.connect() as conn:
        return load_receipt(conn, payment_id)
