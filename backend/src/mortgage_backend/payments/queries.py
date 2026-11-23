"""The payments domain's SQL: Payment queries as plain functions of a Connection.

No HTTP in here: a missing row is `None` or empty and the caller decides what that
means (a 404, a 409).
"""

from collections.abc import Sequence
from datetime import date

from sqlalchemy import RowMapping, func, or_, select
from sqlalchemy.engine import Connection

from mortgage_backend.platform.db import (
    advance_instalment_table,
    customer_table,
    mortgage_table,
    payment_table,
)


def payment_with_customer(conn: Connection, payment_id: int) -> RowMapping | None:
    """The Payment, voided or not, with its Customer's name and numbers."""
    return (
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


def receipt_parts(conn: Connection, first_id: int) -> Sequence[RowMapping]:
    """The (id, amount) of every unvoided part of the Payment `first_id` starts: it and
    those received with it, which share one Receipt."""
    return (
        conn.execute(
            select(payment_table.c.id, payment_table.c.amount)
            .where(
                or_(
                    payment_table.c.id == first_id,
                    payment_table.c.received_with == first_id,
                ),
                payment_table.c.voided_at.is_(None),
            )
            .order_by(payment_table.c.id)
        )
        .mappings()
        .all()
    )


def advance_parts_of(
    conn: Connection, payment_ids: Sequence[int]
) -> Sequence[RowMapping]:
    """The Advance Instalments of these Payments, cancelled ones too, by date."""
    return (
        conn.execute(
            select(advance_instalment_table)
            .where(advance_instalment_table.c.payment_id.in_(list(payment_ids)))
            .order_by(advance_instalment_table.c.on, advance_instalment_table.c.id)
        )
        .mappings()
        .all()
    )


def instalment_with_closed_on(
    conn: Connection, payment_id: int, instalment_id: int
) -> RowMapping | None:
    """The Payment's Advance Instalment, with the closing date of its Mortgage."""
    return (
        conn.execute(
            select(advance_instalment_table, mortgage_table.c.closed_on)
            .join(
                mortgage_table,
                mortgage_table.c.id == advance_instalment_table.c.mortgage_id,
            )
            .where(
                advance_instalment_table.c.id == instalment_id,
                advance_instalment_table.c.payment_id == payment_id,
            )
        )
        .mappings()
        .first()
    )


def received_total(conn: Connection, first: date, last: date) -> int:
    """Paise received from `first` to `last` (inclusive), Voided Payments left out."""
    total: int = conn.execute(
        select(func.coalesce(func.sum(payment_table.c.amount), 0)).where(
            payment_table.c.voided_at.is_(None),
            payment_table.c.paid_on.between(first, last),
        )
    ).scalar_one()
    return total


def received_between(
    conn: Connection, first: date, last: date
) -> list[tuple[date, int]]:
    """Each unvoided Payment's (paid_on, amount) from `first` to `last` (inclusive)."""
    return [
        (paid_on, amount)
        for paid_on, amount in conn.execute(
            select(payment_table.c.paid_on, payment_table.c.amount).where(
                payment_table.c.voided_at.is_(None),
                payment_table.c.paid_on >= first,
                payment_table.c.paid_on <= last,
            )
        )
    ]
