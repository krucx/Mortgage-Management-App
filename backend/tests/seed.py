"""Rows written straight into the database, for tests below the HTTP interface."""

from datetime import date, datetime

from sqlalchemy import insert, update
from sqlalchemy.engine import Connection

from mortgage_backend.db import (
    allocation_table,
    customer_table,
    mortgage_table,
    payment_table,
)

RUPEE = 100  # paise
LAKH = 1_00_000 * RUPEE


def add_customer(conn: Connection, phone: str = "9829012345") -> int:
    customer_id: int = conn.execute(
        insert(customer_table)
        .values(name="Ramesh Kumar", address="", phone_1=phone)
        .returning(customer_table.c.id)
    ).scalar_one()
    return customer_id


def add_mortgage(conn: Connection, customer_id: int, **overrides: object) -> int:
    values = {
        "customer_id": customer_id,
        "name": f"2026-Ramesh-{overrides.pop('suffix', 'Chain')}",
        "start_date": date(2026, 1, 14),
        "amount_lent": LAKH,
        "description": "Gold chain",
        "gross_weight_mg": 20_000,
        "net_weight_mg": 19_000,
        "purity_karat": 22,
        "monthly_rate_bps": 300,
        "interest_mode": "simple",
        "part_month_rule": "full_month",
        **overrides,
    }
    mortgage_id: int = conn.execute(
        insert(mortgage_table).values(**values).returning(mortgage_table.c.id)
    ).scalar_one()
    return mortgage_id


def add_payment(
    conn: Connection,
    customer_id: int,
    paid_on: date,
    allocations: dict[int, int],
    voided: bool = False,
) -> int:
    payment_id: int = conn.execute(
        insert(payment_table)
        .values(
            customer_id=customer_id,
            paid_on=paid_on,
            amount=sum(allocations.values()),
            method="cash",
            voided_at=datetime(2026, 4, 20, 10) if voided else None,
            void_reason="mistake" if voided else None,
        )
        .returning(payment_table.c.id)
    ).scalar_one()
    conn.execute(
        insert(allocation_table),
        [
            {"payment_id": payment_id, "mortgage_id": mortgage_id, "amount": amount}
            for mortgage_id, amount in allocations.items()
        ],
    )
    return payment_id


def close(conn: Connection, mortgage_id: int, **values: object) -> None:
    conn.execute(
        update(mortgage_table)
        .where(mortgage_table.c.id == mortgage_id)
        .values(**values)
    )
