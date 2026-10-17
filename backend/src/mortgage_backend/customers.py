"""Customers and the Referrers who introduced them (see GLOSSARY.md)."""

import re
from typing import Annotated, Literal

from fastapi import APIRouter, HTTPException, Query, Response, UploadFile, status
from pydantic import AfterValidator, BaseModel, Field
from sqlalchemy import (
    Column,
    ColumnElement,
    Table,
    delete,
    func,
    insert,
    or_,
    select,
    true,
    update,
)
from sqlalchemy.engine import Connection, RowMapping

from mortgage_backend.db import EngineDep, customer_table, standalone_referrer_table
from mortgage_backend.photos import PhotosDirDep, delete_photo, photo_url, save_photo


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


class CustomerPage(BaseModel):
    items: list[CustomerRow]
    total: int
    page: int
    page_size: int


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


def _unprocessable(message: str) -> HTTPException:
    return HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, message)


def _exists(conn: Connection, table: Table, row_id: int) -> bool:
    return (
        conn.execute(select(table.c.id).where(table.c.id == row_id)).first() is not None
    )


def _reject_duplicate(
    conn: Connection, customer: CustomerIn, customer_id: int | None = None
) -> None:
    """One Customer per name (ignoring case) and contact number 1."""
    same = conn.execute(
        select(customer_table.c.id).where(
            func.lower(customer_table.c.name) == customer.name.lower(),
            customer_table.c.phone_1 == customer.phone_1,
            customer_table.c.id.is_distinct_from(customer_id),
        )
    ).first()
    if same is not None:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"A Customer named {customer.name} with contact number 1 "
            f"{customer.phone_1} already exists",
        )


def _referrer_columns(
    conn: Connection, choice: ReferrerChoice | None
) -> dict[str, int | None]:
    """Turn a Referrer choice into the customer row's two referrer columns (at most one set)."""
    match choice:
        case None:
            return {
                "referred_by_customer_id": None,
                "referred_by_standalone_referrer_id": None,
            }
        case ExistingCustomerReferrer(id=customer_id):
            if not _exists(conn, customer_table, customer_id):
                raise _unprocessable("Referrer Customer not found")
            return {
                "referred_by_customer_id": customer_id,
                "referred_by_standalone_referrer_id": None,
            }
        case ExistingStandaloneReferrer(id=referrer_id):
            if not _exists(conn, standalone_referrer_table, referrer_id):
                raise _unprocessable("Referrer not found")
            return {
                "referred_by_customer_id": None,
                "referred_by_standalone_referrer_id": referrer_id,
            }
        case NewStandaloneReferrer():
            new_id = conn.execute(
                insert(standalone_referrer_table)
                .values(name=choice.name, address=choice.address, phone=choice.phone)
                .returning(standalone_referrer_table.c.id)
            ).scalar_one()
            return {
                "referred_by_customer_id": None,
                "referred_by_standalone_referrer_id": new_id,
            }


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


def _load_customer(conn: Connection, customer_id: int) -> Customer:
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


@router.post("/customers", status_code=status.HTTP_201_CREATED)
def create_customer(customer: CustomerIn, engine: EngineDep) -> Customer:
    with engine.begin() as conn:
        _reject_duplicate(conn, customer)
        customer_id = conn.execute(
            insert(customer_table)
            .values(
                **customer.model_dump(exclude={"referrer"}),
                **_referrer_columns(conn, customer.referrer),
            )
            .returning(customer_table.c.id)
        ).scalar_one()
        return _load_customer(conn, customer_id)


@router.put("/customers/{customer_id}")
def update_customer(
    customer_id: int, customer: CustomerIn, engine: EngineDep
) -> Customer:
    if (
        isinstance(customer.referrer, ExistingCustomerReferrer)
        and customer.referrer.id == customer_id
    ):
        raise _unprocessable("A Customer cannot be their own Referrer")
    with engine.begin() as conn:
        if not _exists(conn, customer_table, customer_id):
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Customer not found")
        _reject_duplicate(conn, customer, customer_id)
        conn.execute(
            update(customer_table)
            .where(customer_table.c.id == customer_id)
            .values(
                **customer.model_dump(exclude={"referrer"}),
                **_referrer_columns(conn, customer.referrer),
            )
        )
        return _load_customer(conn, customer_id)


@router.put("/customers/{customer_id}/photo")
async def replace_customer_photo(
    customer_id: int, photo: UploadFile, engine: EngineDep, photos_dir: PhotosDirDep
) -> Customer:
    with engine.connect() as conn:
        if not _exists(conn, customer_table, customer_id):
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Customer not found")
    file_name = save_photo(photos_dir, "customer", customer_id, await photo.read())
    with engine.begin() as conn:
        old = conn.execute(
            select(customer_table.c.photo).where(customer_table.c.id == customer_id)
        ).scalar_one()
        conn.execute(
            update(customer_table)
            .where(customer_table.c.id == customer_id)
            .values(photo=file_name)
        )
        customer = _load_customer(conn, customer_id)
    delete_photo(photos_dir, old)
    return customer


@router.get("/customers/{customer_id}")
def read_customer(customer_id: int, engine: EngineDep) -> Customer:
    with engine.connect() as conn:
        return _load_customer(conn, customer_id)


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


PAGE_SIZE = 20


@router.get("/customers")
def list_customers(
    engine: EngineDep, page: Annotated[int, Query(ge=1)] = 1, q: str = ""
) -> CustomerPage:
    """All Customers by name, a page at a time, optionally filtered by name or phone."""
    query = q.strip()
    match = _customer_matches(query) if query else true()
    with engine.connect() as conn:
        total = conn.execute(
            select(func.count()).select_from(customer_table).where(match)
        ).scalar_one()
        rows = conn.execute(
            select(customer_table)
            .where(match)
            .order_by(func.lower(customer_table.c.name), customer_table.c.id)
            .limit(PAGE_SIZE)
            .offset((page - 1) * PAGE_SIZE)
        ).mappings()
        items = [_customer_row(conn, row) for row in rows]
    return CustomerPage(items=items, total=total, page=page, page_size=PAGE_SIZE)


@router.delete("/customers/{customer_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_customer(
    customer_id: int, engine: EngineDep, photos_dir: PhotosDirDep
) -> Response:
    """Delete a Customer; anyone they referred keeps their record but loses the link."""
    with engine.begin() as conn:
        photo = conn.execute(
            select(customer_table.c.photo).where(customer_table.c.id == customer_id)
        ).first()
        if photo is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Customer not found")
        conn.execute(
            update(customer_table)
            .where(customer_table.c.referred_by_customer_id == customer_id)
            .values(referred_by_customer_id=None)
        )
        conn.execute(delete(customer_table).where(customer_table.c.id == customer_id))
    delete_photo(photos_dir, photo.photo)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
