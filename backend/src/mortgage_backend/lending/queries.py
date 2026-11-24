"""The lending domain's SQL: Mortgage queries as plain functions of a Connection.

No HTTP in here: a missing row is `None` or empty and the caller decides what that
means (a 404, a 422). Controllers parse the request and shape the response; the tables,
joins and filters live here.
"""

from collections.abc import Sequence
from datetime import date
from typing import Any

from sqlalchemy import ColumnElement, Row, Select, false, func, or_, select, true
from sqlalchemy.engine import Connection, RowMapping

from mortgage_backend.lending.replay import MortgageStatus
from mortgage_backend.people.customers import phone_fragment
from mortgage_backend.platform.clock import month_span
from mortgage_backend.platform.db import (
    customer_table,
    mortgage_photo_table,
    mortgage_table,
)


def select_with_customer() -> Select[Any]:
    """Mortgages joined to their Customer's name."""
    return select(mortgage_table, customer_table.c.name.label("customer_name")).join(
        customer_table, customer_table.c.id == mortgage_table.c.customer_id
    )


def mortgage_with_customer(conn: Connection, mortgage_id: int) -> RowMapping | None:
    return (
        conn.execute(select_with_customer().where(mortgage_table.c.id == mortgage_id))
        .mappings()
        .first()
    )


def photos_of(conn: Connection, mortgage_id: int) -> Sequence[Row[Any]]:
    """The Mortgage's photos, in the order they were added."""
    return conn.execute(
        select(mortgage_photo_table)
        .where(mortgage_photo_table.c.mortgage_id == mortgage_id)
        .order_by(mortgage_photo_table.c.id)
    ).all()


def names_like(conn: Connection, name: str) -> set[str]:
    """The Mortgage Names (lower-cased) that are `name` or `name-…`, ignoring case."""
    return {
        taken.lower()
        for taken in conn.execute(
            select(mortgage_table.c.name).where(
                or_(
                    func.lower(mortgage_table.c.name) == name.lower(),
                    mortgage_table.c.name.ilike(f"{name}-%"),
                )
            )
        ).scalars()
    }


def customer_name_of(conn: Connection, customer_id: int) -> str | None:
    name: str | None = conn.execute(
        select(customer_table.c.name).where(customer_table.c.id == customer_id)
    ).scalar()
    return name


def mortgage_filter(
    *,
    query: str = "",
    customer_id: int | None = None,
    as_of: date | None = None,
    status: MortgageStatus | None = None,
    closed: bool = False,
    closed_in: str | None = None,
) -> ColumnElement[bool]:
    """The WHERE of the Mortgage list over `select_with_customer()`: `query` matches a
    Mortgage Name, Customer name or (part of) the Customer's Primary Number; the rest narrow as the list's filters do. `closed_in` is YYYY-MM."""
    # Digits may be part of a Mortgage Name (its year) as well as of a phone number.
    phone = phone_fragment(query)
    match: ColumnElement[bool] = (
        or_(
            mortgage_table.c.name.icontains(query),
            customer_table.c.name.icontains(query),
            customer_table.c.phone_1.contains(phone) if phone else false(),
        )
        if query
        else true()
    )
    if customer_id is not None:
        match = match & (mortgage_table.c.customer_id == customer_id)
    if as_of is not None:
        match = match & (mortgage_table.c.start_date <= as_of)
    if status is not None:
        match = match & (mortgage_table.c.status == status)
    if closed:
        match = match & (mortgage_table.c.status != MortgageStatus.ACTIVE)
    if closed_in is not None:
        match = match & mortgage_table.c.closed_on.between(*month_span(closed_in))
    return match


def matching_mortgages(match: ColumnElement[bool]) -> Select[Any]:
    """The Mortgages with their Customer's name that satisfy `match`."""
    return select_with_customer().where(match)


def fetch_matching_mortgages(
    conn: Connection, match: ColumnElement[bool], order_by: Sequence[Any]
) -> Sequence[RowMapping]:
    return conn.execute(matching_mortgages(match).order_by(*order_by)).mappings().all()


def principal_lent_between(conn: Connection, first: date, last: date) -> int:
    """What the Mortgages started from `first` to `last` (inclusive) lent, in paise."""
    total: int = conn.execute(
        select(func.coalesce(func.sum(mortgage_table.c.amount_lent), 0)).where(
            mortgage_table.c.start_date.between(first, last)
        )
    ).scalar_one()
    return total


def redemptions_between(conn: Connection, first: date, last: date) -> int:
    """How many Mortgages were Redeemed from `first` to `last` (inclusive)."""
    count: int = conn.execute(
        select(func.count()).where(
            mortgage_table.c.status == MortgageStatus.REDEEMED,
            mortgage_table.c.closed_on.between(first, last),
        )
    ).scalar_one()
    return count
