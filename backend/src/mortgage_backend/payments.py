"""Payments from a Customer, each split into Allocations to their Mortgages (see GLOSSARY.md)."""

from collections.abc import Sequence
from datetime import date, datetime
from enum import StrEnum
from typing import Annotated

from fastapi import APIRouter, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import exists as sql_exists
from sqlalchemy import func, or_, select, true
from sqlalchemy.engine import Connection, RowMapping

from mortgage_backend.customers import PersonSummary
from mortgage_backend.db import (
    EngineDep,
    allocation_table,
    customer_table,
    mortgage_table,
    payment_table,
)
from mortgage_backend.replay import replays


class PaymentMethod(StrEnum):
    CASH = "cash"
    UPI = "upi"
    BANK_TRANSFER = "bank_transfer"


class AllocationOut(BaseModel):
    mortgage_id: int
    mortgage_name: str
    amount: int
    # How it was applied: interest first, then Principal (None once Voided)
    interest_paid: int | None
    principal_paid: int | None


class Payment(BaseModel):
    id: int
    customer: PersonSummary
    paid_on: date
    amount: int
    method: PaymentMethod
    reference: str | None
    allocations: list[AllocationOut]
    voided_at: datetime | None
    void_reason: str | None


class MortgageLink(BaseModel):
    id: int
    name: str


class PaymentRow(BaseModel):
    """A Payment as listed on the Payments page."""

    id: int
    paid_on: date
    customer: PersonSummary
    amount: int
    method: PaymentMethod
    reference: str | None
    mortgages: list[MortgageLink]  # in the order the Allocations were made
    voided: bool


class PaymentPage(BaseModel):
    items: list[PaymentRow]
    total: int
    page: int
    page_size: int


def mortgages_of(conn: Connection, payment_id: int) -> Sequence[RowMapping]:
    """The Mortgages a Payment is allocated to (with the amount, as `allocated`), in the
    order the Allocations were made."""
    return (
        conn.execute(
            select(mortgage_table, allocation_table.c.amount.label("allocated"))
            .join(
                allocation_table, allocation_table.c.mortgage_id == mortgage_table.c.id
            )
            .where(allocation_table.c.payment_id == payment_id)
            .order_by(allocation_table.c.id)
        )
        .mappings()
        .all()
    )


def load_payment(conn: Connection, payment_id: int) -> Payment:
    payment = conn.execute(
        select(payment_table, customer_table.c.name.label("customer_name"))
        .join(customer_table, customer_table.c.id == payment_table.c.customer_id)
        .where(payment_table.c.id == payment_id)
    ).first()
    if payment is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Payment not found")

    mortgages = mortgages_of(conn, payment_id)
    voided = payment.voided_at is not None
    # How it was applied comes from the replay, so it reflects every earlier Payment; a
    # Voided Payment is in no Ledger, so only its amounts remain.
    replayed = {} if voided else replays(conn, mortgages)
    allocations = []
    for mortgage in mortgages:
        step = None
        if not voided:
            step = next(
                s
                for s in replayed[mortgage["id"]].ledger(payment.paid_on)
                if s.payment_id == payment_id
            )
        allocations.append(
            AllocationOut(
                mortgage_id=mortgage["id"],
                mortgage_name=mortgage["name"],
                amount=mortgage["allocated"],
                interest_paid=step.interest_paid if step else None,
                principal_paid=step.principal_paid if step else None,
            )
        )
    return Payment(
        id=payment.id,
        customer=PersonSummary(
            kind="customer", id=payment.customer_id, name=payment.customer_name
        ),
        paid_on=payment.paid_on,
        amount=payment.amount,
        method=payment.method,
        reference=payment.reference,
        allocations=allocations,
        voided_at=payment.voided_at,
        void_reason=payment.void_reason,
    )


router = APIRouter(prefix="/api")


@router.get("/payments/{payment_id}")
def read_payment(payment_id: int, engine: EngineDep) -> Payment:
    with engine.connect() as conn:
        return load_payment(conn, payment_id)


PAGE_SIZE = 20


@router.get("/payments")
def list_payments(
    engine: EngineDep, page: Annotated[int, Query(ge=1)] = 1, q: str = ""
) -> PaymentPage:
    """Payments, newest first, filtered by Customer, Mortgage Name or reference."""
    query = q.strip()
    match = (
        or_(
            customer_table.c.name.icontains(query),
            payment_table.c.reference.icontains(query),
            sql_exists().where(
                allocation_table.c.payment_id == payment_table.c.id,
                allocation_table.c.mortgage_id == mortgage_table.c.id,
                mortgage_table.c.name.icontains(query),
            ),
        )
        if query
        else true()
    )
    with_customer = payment_table.join(
        customer_table, customer_table.c.id == payment_table.c.customer_id
    )
    with engine.connect() as conn:
        total = conn.execute(
            select(func.count()).select_from(with_customer).where(match)
        ).scalar_one()
        payments = conn.execute(
            select(payment_table, customer_table.c.name.label("customer_name"))
            .select_from(with_customer)
            .where(match)
            .order_by(payment_table.c.paid_on.desc(), payment_table.c.id.desc())
            .limit(PAGE_SIZE)
            .offset((page - 1) * PAGE_SIZE)
        ).all()
        allocated: dict[int, list[MortgageLink]] = {p.id: [] for p in payments}
        for row in conn.execute(
            select(
                allocation_table.c.payment_id,
                mortgage_table.c.id,
                mortgage_table.c.name,
            )
            .join(mortgage_table, mortgage_table.c.id == allocation_table.c.mortgage_id)
            .where(allocation_table.c.payment_id.in_(allocated))
            .order_by(allocation_table.c.id)
        ):
            allocated[row.payment_id].append(MortgageLink(id=row.id, name=row.name))
    items = [
        PaymentRow(
            id=payment.id,
            paid_on=payment.paid_on,
            customer=PersonSummary(
                kind="customer", id=payment.customer_id, name=payment.customer_name
            ),
            amount=payment.amount,
            method=payment.method,
            reference=payment.reference,
            mortgages=allocated[payment.id],
            voided=payment.voided_at is not None,
        )
        for payment in payments
    ]
    return PaymentPage(items=items, total=total, page=page, page_size=PAGE_SIZE)
