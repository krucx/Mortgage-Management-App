"""Payments from a Customer, each split into Allocations to their Mortgages (see GLOSSARY.md)."""

from collections.abc import Sequence
from datetime import date
from enum import StrEnum
from typing import Annotated

from fastapi import APIRouter, HTTPException, Query, status
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import exists as sql_exists
from sqlalchemy import func, insert, or_, select, true
from sqlalchemy.engine import Connection, RowMapping

from mortgage_backend.clock import TodayDep
from mortgage_backend.customers import PersonSummary
from mortgage_backend.db import (
    EngineDep,
    allocation_table,
    customer_table,
    exists,
    mortgage_table,
    payment_table,
)
from mortgage_backend.errors import unprocessable
from mortgage_backend.ledger import Overpayment
from mortgage_backend.money import format_inr
from mortgage_backend.mortgages import MortgageStatus, ledgers_of


class PaymentMethod(StrEnum):
    CASH = "cash"
    UPI = "upi"
    BANK_TRANSFER = "bank_transfer"


class AllocationIn(BaseModel):
    mortgage_id: int
    amount: int = Field(gt=0)  # paise


class PaymentIn(BaseModel):
    customer_id: int
    paid_on: date
    amount: int = Field(gt=0)  # paise
    method: PaymentMethod
    reference: str | None = None
    allocations: list[AllocationIn] = Field(min_length=1)

    @model_validator(mode="after")
    def allocations_add_up(self) -> "PaymentIn":
        if sum(allocation.amount for allocation in self.allocations) != self.amount:
            raise ValueError("Allocations must add up to the Payment amount")
        if len({a.mortgage_id for a in self.allocations}) != len(self.allocations):
            raise ValueError("Each Mortgage can appear only once in a Payment")
        self.reference = (self.reference or "").strip() or None
        return self


class AllocationOut(BaseModel):
    mortgage_id: int
    mortgage_name: str
    amount: int
    interest_paid: int  # paid interest first…
    principal_paid: int  # …then Principal


class Payment(BaseModel):
    id: int
    customer: PersonSummary
    paid_on: date
    amount: int
    method: PaymentMethod
    reference: str | None
    allocations: list[AllocationOut]


class PaymentRow(BaseModel):
    """A Payment as listed on the Payments page."""

    id: int
    paid_on: date
    customer: PersonSummary
    amount: int
    method: PaymentMethod
    reference: str | None
    mortgage_names: list[str]


class PaymentPage(BaseModel):
    items: list[PaymentRow]
    total: int
    page: int
    page_size: int


def _mortgages_of(conn: Connection, payment_id: int) -> Sequence[RowMapping]:
    """The Mortgages a Payment is allocated to, in the order the Allocations were made."""
    return (
        conn.execute(
            select(mortgage_table)
            .join(
                allocation_table, allocation_table.c.mortgage_id == mortgage_table.c.id
            )
            .where(allocation_table.c.payment_id == payment_id)
            .order_by(allocation_table.c.id)
        )
        .mappings()
        .all()
    )


def _load_payment(conn: Connection, payment_id: int) -> Payment:
    payment = conn.execute(
        select(payment_table, customer_table.c.name.label("customer_name"))
        .join(customer_table, customer_table.c.id == payment_table.c.customer_id)
        .where(payment_table.c.id == payment_id)
    ).first()
    if payment is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Payment not found")

    mortgages = _mortgages_of(conn, payment_id)
    ledgers = ledgers_of(conn, mortgages, payment.paid_on)
    allocations = []
    for mortgage in mortgages:
        # How it split comes from the replay, so it reflects every earlier Payment.
        step = next(s for s in ledgers[mortgage["id"]] if s.payment_id == payment_id)
        allocations.append(
            AllocationOut(
                mortgage_id=mortgage["id"],
                mortgage_name=mortgage["name"],
                amount=step.amount,
                interest_paid=step.interest_paid,
                principal_paid=step.principal_paid,
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
    )


def insert_payment(conn: Connection, payment: PaymentIn) -> int:
    """Store a Payment and its Allocations; returns its id. Callers check it first."""
    payment_id: int = conn.execute(
        insert(payment_table)
        .values(**payment.model_dump(exclude={"allocations"}))
        .returning(payment_table.c.id)
    ).scalar_one()
    conn.execute(
        insert(allocation_table),
        [{"payment_id": payment_id, **a.model_dump()} for a in payment.allocations],
    )
    return payment_id


def check_no_overpayment(conn: Connection, payment_id: int, today: date) -> None:
    """Replay each Mortgage the Payment touches; no Allocation may pay more than is owed."""
    for mortgage in _mortgages_of(conn, payment_id):
        try:
            ledgers_of(conn, [mortgage], today)
        except Overpayment as over:
            if over.payment_id == payment_id:
                raise unprocessable(
                    f"{mortgage['name']}: only {format_inr(over.outstanding)} was owed on "
                    f"{over.on:%d %b %Y}, less than this Payment"
                )
            raise unprocessable(
                f"{mortgage['name']}: this Payment would leave a later Payment on "
                f"{over.on:%d %b %Y} larger than the {format_inr(over.outstanding)} owed then"
            )


router = APIRouter(prefix="/api")


@router.post("/payments", status_code=status.HTTP_201_CREATED)
def record_payment(payment: PaymentIn, engine: EngineDep, today: TodayDep) -> Payment:
    if payment.paid_on > today:
        raise unprocessable("The Payment date cannot be in the future")
    with engine.begin() as conn:
        if not exists(conn, customer_table, payment.customer_id):
            raise unprocessable("Customer not found")
        for allocation in payment.allocations:
            mortgage = conn.execute(
                select(mortgage_table).where(
                    mortgage_table.c.id == allocation.mortgage_id
                )
            ).first()
            if mortgage is None or mortgage.customer_id != payment.customer_id:
                raise unprocessable("Each Mortgage must belong to the paying Customer")
            if mortgage.status != MortgageStatus.ACTIVE:
                raise unprocessable(f"{mortgage.name} is not Active")
            if payment.paid_on < mortgage.start_date:
                raise unprocessable(f"{mortgage.name} had not started on that date")

        payment_id = insert_payment(conn, payment)
        # Raising here rolls the whole Payment back.
        check_no_overpayment(conn, payment_id, today)
        return _load_payment(conn, payment_id)


@router.get("/payments/{payment_id}")
def read_payment(payment_id: int, engine: EngineDep) -> Payment:
    with engine.connect() as conn:
        return _load_payment(conn, payment_id)


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
        names: dict[int, list[str]] = {payment.id: [] for payment in payments}
        for row in conn.execute(
            select(allocation_table.c.payment_id, mortgage_table.c.name)
            .join(mortgage_table, mortgage_table.c.id == allocation_table.c.mortgage_id)
            .where(allocation_table.c.payment_id.in_(names))
            .order_by(allocation_table.c.id)
        ):
            names[row.payment_id].append(row.name)
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
            mortgage_names=names[payment.id],
        )
        for payment in payments
    ]
    return PaymentPage(items=items, total=total, page=page, page_size=PAGE_SIZE)
