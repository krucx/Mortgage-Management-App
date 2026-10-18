"""Customers and the Referrers who introduced them (see GLOSSARY.md)."""

import re
from typing import Annotated, Literal

from fastapi import APIRouter, HTTPException, status
from pydantic import AfterValidator, BaseModel, Field
from sqlalchemy import (
    Column,
    ColumnElement,
    func,
    or_,
    select,
    true,
)
from sqlalchemy import exists as sql_exists
from sqlalchemy.engine import Connection, RowMapping

from mortgage_backend.lending.replay import MortgageStatus
from mortgage_backend.platform.db import (
    EngineDep,
    customer_table,
    mortgage_table,
    standalone_referrer_table,
)
from mortgage_backend.platform.paging import Page, PageNumber, Sorting, query_page
from mortgage_backend.platform.photos import photo_url


def normalise_phone(raw: str) -> str:
    """Reduce an Indian mobile number to its 10 digits, e.g. "+91 98290-12345" → "9829012345"."""
    digits = re.sub(r"\D", "", raw)
    if len(digits) == 12 and digits.startswith("91"):
        digits = digits[2:]
    elif len(digits) == 11 and digits.startswith("0"):
        digits = digits[1:]
    if len(digits) != 10:
        raise ValueError("must be a 10-digit mobile number")
    return digits


Phone = Annotated[str, AfterValidator(normalise_phone)]


def tidy_name(raw: str) -> str:
    """Trim and collapse spaces, e.g. "  Ramesh   Kumar " → "Ramesh Kumar"."""
    name = " ".join(raw.split())
    if not name:
        raise ValueError("must not be empty")
    return name


Name = Annotated[str, AfterValidator(tidy_name)]


# --- Choosing a Referrer: an existing Customer, an existing standalone Referrer, or a new one.


class ExistingCustomerReferrer(BaseModel):
    kind: Literal["customer"]
    id: int


class ExistingStandaloneReferrer(BaseModel):
    kind: Literal["referrer"]
    id: int


class NewStandaloneReferrer(BaseModel):
    kind: Literal["new"]
    name: Name
    address: str
    phone: Phone


ReferrerChoice = Annotated[
    ExistingCustomerReferrer | ExistingStandaloneReferrer | NewStandaloneReferrer,
    Field(discriminator="kind"),
]


class CustomerIn(BaseModel):
    name: Name
    address: str
    phone_1: Phone
    phone_2: Phone | None = None
    referrer: ReferrerChoice | None = None


class PersonSummary(BaseModel):
    """A Customer or standalone Referrer, as shown in lists and links."""

    kind: Literal["customer", "referrer"]
    id: int
    name: str


class CustomerRow(BaseModel):
    """A Customer as listed in the Customers table."""

    id: int
    name: str
    address: str
    phone_1: str
    phone_2: str | None
    photo_url: str | None
    referrer: PersonSummary | None


# A column of the Customers list to sort it by.
CustomerSort = Literal["name", "phone", "address", "referrer"]


_referrer = customer_table.alias("referrer")

_SORTING = Sorting[CustomerSort](
    columns={
        "name": func.lower(customer_table.c.name),
        "phone": customer_table.c.phone_1,
        "address": func.lower(customer_table.c.address),
        # The Referrer's name, a Customer's or a standalone Referrer's; none sorts first.
        "referrer": func.lower(
            func.coalesce(
                select(_referrer.c.name)
                .where(_referrer.c.id == customer_table.c.referred_by_customer_id)
                .scalar_subquery(),
                select(standalone_referrer_table.c.name)
                .where(
                    standalone_referrer_table.c.id
                    == customer_table.c.referred_by_standalone_referrer_id
                )
                .scalar_subquery(),
                "",
            )
        ),
    },
    ties=[customer_table.c.id],
)


class Customer(CustomerRow):
    """A Customer's own page."""

    referred: list[PersonSummary]
    # Other Customers using either of this Customer's numbers: a warning, never a block.
    shares_phone_with: list[PersonSummary]


class SearchHit(BaseModel):
    kind: Literal["customer", "referrer"]
    id: int
    name: str
    phone: str
    photo_url: str | None


class StandaloneReferrer(BaseModel):
    id: int
    name: str
    address: str
    phone: str
    referred: list[PersonSummary]


def phones_of(row: RowMapping) -> list[str]:
    """A Customer's contact numbers, primary first."""
    return [phone for phone in (row["phone_1"], row["phone_2"]) if phone]


def owner_of(conn: Connection, phone: str) -> PersonSummary | None:
    """The person whose Primary Number this is, if anyone's."""
    customer = conn.execute(
        select(customer_table.c.id, customer_table.c.name).where(
            customer_table.c.phone_1 == phone
        )
    ).first()
    if customer is not None:
        return PersonSummary(kind="customer", id=customer.id, name=customer.name)
    referrer = conn.execute(
        select(standalone_referrer_table.c.id, standalone_referrer_table.c.name).where(
            standalone_referrer_table.c.phone == phone
        )
    ).first()
    if referrer is not None:
        return PersonSummary(kind="referrer", id=referrer.id, name=referrer.name)
    return None


def _customers_referred_by(
    conn: Connection, referrer_column: Column[int], referrer_id: int
) -> list[PersonSummary]:
    rows = conn.execute(
        select(customer_table.c.id, customer_table.c.name)
        .where(referrer_column == referrer_id)
        .order_by(customer_table.c.name)
    )
    return [PersonSummary(kind="customer", id=row.id, name=row.name) for row in rows]


def _customers_sharing_a_phone(
    conn: Connection, customer_id: int, phones: list[str]
) -> list[PersonSummary]:
    rows = conn.execute(
        select(customer_table.c.id, customer_table.c.name)
        .where(
            customer_table.c.id != customer_id,
            or_(
                customer_table.c.phone_1.in_(phones),
                customer_table.c.phone_2.in_(phones),
            ),
        )
        .order_by(customer_table.c.name)
    )
    return [PersonSummary(kind="customer", id=row.id, name=row.name) for row in rows]


def load_customer(conn: Connection, customer_id: int) -> Customer:
    row = (
        conn.execute(select(customer_table).where(customer_table.c.id == customer_id))
        .mappings()
        .first()
    )
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Customer not found")
    return Customer(
        **_customer_row(conn, row).model_dump(),
        referred=_customers_referred_by(
            conn, customer_table.c.referred_by_customer_id, customer_id
        ),
        shares_phone_with=_customers_sharing_a_phone(
            conn,
            customer_id,
            [phone for phone in (row["phone_1"], row["phone_2"]) if phone],
        ),
    )


def _customer_row(conn: Connection, row: RowMapping) -> CustomerRow:
    referrer = None
    if row["referred_by_customer_id"] is not None:
        name = conn.execute(
            select(customer_table.c.name).where(
                customer_table.c.id == row["referred_by_customer_id"]
            )
        ).scalar_one()
        referrer = PersonSummary(
            kind="customer", id=row["referred_by_customer_id"], name=name
        )
    elif row["referred_by_standalone_referrer_id"] is not None:
        referrer_id = row["referred_by_standalone_referrer_id"]
        name = conn.execute(
            select(standalone_referrer_table.c.name).where(
                standalone_referrer_table.c.id == referrer_id
            )
        ).scalar_one()
        referrer = PersonSummary(kind="referrer", id=referrer_id, name=name)

    return CustomerRow(
        id=row["id"],
        name=row["name"],
        address=row["address"],
        phone_1=row["phone_1"],
        phone_2=row["phone_2"],
        photo_url=photo_url(row["photo"]),
        referrer=referrer,
    )


router = APIRouter(prefix="/api")


@router.get("/customers/{customer_id}")
def read_customer(customer_id: int, engine: EngineDep) -> Customer:
    with engine.connect() as conn:
        return load_customer(conn, customer_id)


@router.get("/referrers/{referrer_id}")
def read_referrer(referrer_id: int, engine: EngineDep) -> StandaloneReferrer:
    with engine.connect() as conn:
        row = conn.execute(
            select(standalone_referrer_table).where(
                standalone_referrer_table.c.id == referrer_id
            )
        ).first()
        if row is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Referrer not found")
        return StandaloneReferrer(
            id=row.id,
            name=row.name,
            address=row.address,
            phone=row.phone,
            referred=_customers_referred_by(
                conn, customer_table.c.referred_by_standalone_referrer_id, referrer_id
            ),
        )


SEARCH_LIMIT = 25


def _phone_fragment(query: str) -> str | None:
    """Digits to match against phone numbers, if the query looks like (part of) a phone number."""
    if re.search(r"[^\d\s+()-]", query):
        return None
    digits = re.sub(r"\D", "", query)
    if len(digits) < 3:
        return None
    try:
        return normalise_phone(digits)  # a full number typed with +91 / 0
    except ValueError:
        return digits


def _customer_matches(query: str) -> ColumnElement[bool]:
    """Customers whose name, or either contact number, matches the query."""
    phone = _phone_fragment(query)
    if phone:
        return or_(
            customer_table.c.phone_1.contains(phone),
            customer_table.c.phone_2.contains(phone),
        )
    return customer_table.c.name.icontains(query)


@router.get("/search")
def search(q: str, engine: EngineDep) -> list[SearchHit]:
    """Customers and standalone Referrers whose name or phone number matches."""
    query = q.strip()
    if not query:
        return []
    phone = _phone_fragment(query)
    customer_match = _customer_matches(query)
    referrer_match = (
        standalone_referrer_table.c.phone.contains(phone)
        if phone
        else standalone_referrer_table.c.name.icontains(query)
    )

    with engine.connect() as conn:
        customers = conn.execute(
            select(
                customer_table.c.id,
                customer_table.c.name,
                customer_table.c.phone_1,
                customer_table.c.photo,
            )
            .where(customer_match)
            .limit(SEARCH_LIMIT)
        )
        referrers = conn.execute(
            select(
                standalone_referrer_table.c.id,
                standalone_referrer_table.c.name,
                standalone_referrer_table.c.phone,
            )
            .where(referrer_match)
            .limit(SEARCH_LIMIT)
        )
        hits = [
            SearchHit(
                kind="customer",
                id=row.id,
                name=row.name,
                phone=row.phone_1,
                photo_url=photo_url(row.photo),
            )
            for row in customers
        ] + [
            SearchHit(
                kind="referrer",
                id=row.id,
                name=row.name,
                phone=row.phone,
                photo_url=None,
            )
            for row in referrers
        ]
    return sorted(hits, key=lambda hit: hit.name.lower())[:SEARCH_LIMIT]


@router.get("/customers")
def list_customers(
    engine: EngineDep,
    page: PageNumber = 1,
    q: str = "",
    has_active_mortgage: bool = False,
    sort: CustomerSort = "name",
    descending: bool = False,
) -> Page[CustomerRow]:
    """All Customers by name (or `sort`, reversed when `descending`), a page at a
    time, optionally filtered by name or phone, or to those with an Active Mortgage."""
    query = q.strip()
    match = _customer_matches(query) if query else true()
    if has_active_mortgage:
        match = match & sql_exists().where(
            mortgage_table.c.customer_id == customer_table.c.id,
            mortgage_table.c.status == MortgageStatus.ACTIVE,
        )
    with engine.connect() as conn:
        return query_page(
            conn,
            select(customer_table).where(match),
            _SORTING,
            page,
            lambda rows: [_customer_row(conn, row) for row in rows],
            sort=sort,
            descending=descending,
        )


@router.get("/people/by-phone")
def person_with_number(phone: str, engine: EngineDep) -> PersonSummary | None:
    """Who a Primary Number belongs to, if anyone (None for an incomplete number)."""
    try:
        number = normalise_phone(phone)
    except ValueError:
        return None
    with engine.connect() as conn:
        return owner_of(conn, number)
