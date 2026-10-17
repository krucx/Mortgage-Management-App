"""Mortgages: one loan against one pledged packet of jewellery (see GLOSSARY.md)."""

import re
from collections.abc import Sequence
from datetime import date
from enum import StrEnum
from typing import Annotated, Any, Literal

from fastapi import APIRouter, HTTPException, Query, UploadFile, status
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import Select, delete, func, insert, or_, select, true
from sqlalchemy.engine import Connection, RowMapping

from mortgage_backend.clock import TodayDep
from mortgage_backend.customers import PersonSummary
from mortgage_backend.db import (
    EngineDep,
    allocation_table,
    customer_table,
    exists,
    mortgage_photo_table,
    mortgage_table,
    payment_table,
)
from mortgage_backend.default_terms import get_default_terms
from mortgage_backend.ledger import Allocation, LedgerStep, compute_ledger
from mortgage_backend.photos import PhotosDirDep, delete_photo, photo_url, save_photo
from mortgage_backend.terms import Terms

Purity = Literal[24, 22, 20, 18, 14]


class MortgageStatus(StrEnum):
    ACTIVE = "active"
    REDEEMED = "redeemed"
    FORFEITED = "forfeited"


class MortgageIn(BaseModel):
    customer_id: int
    name: str | None = None  # Mortgage Name; suggested when left out
    start_date: date
    amount_lent: int = Field(gt=0)  # paise; the starting Principal
    description: str
    gross_weight_mg: int = Field(gt=0)
    net_weight_mg: int = Field(gt=0)  # gold only, after stones
    purity_karat: Purity
    terms: Terms | None = None  # None: copy the Default Terms

    @model_validator(mode="after")
    def check(self) -> "MortgageIn":
        if self.net_weight_mg > self.gross_weight_mg:
            raise ValueError("net weight cannot exceed gross weight")
        if self.name is not None:
            self.name = self.name.strip()
            if not re.fullmatch(rf"{self.start_date.year}-\S.*", self.name):
                raise ValueError(
                    f"Mortgage Name must start with {self.start_date.year}-"
                )
        return self


class MortgagePhoto(BaseModel):
    id: int
    url: str


class Outstanding(BaseModel):
    """Principal plus unpaid interest on a date, before any Part-Month Rule charge."""

    principal: int
    unpaid_interest: int
    total: int


class MortgageRow(BaseModel):
    """A Mortgage as listed in tables."""

    id: int
    name: str
    customer: PersonSummary
    start_date: date
    amount_lent: int
    status: MortgageStatus
    outstanding_total: int


class MortgagePage(BaseModel):
    items: list[MortgageRow]
    total: int
    page: int
    page_size: int


class Mortgage(BaseModel):
    """A Mortgage's own page, with its Ledger computed up to `as_of`."""

    id: int
    name: str
    customer: PersonSummary
    start_date: date
    amount_lent: int
    description: str
    gross_weight_mg: int
    net_weight_mg: int
    purity_karat: int
    terms: Terms
    status: MortgageStatus
    photos: list[MortgagePhoto]
    as_of: date
    ledger: list[LedgerStep]
    outstanding: Outstanding


def _terms(row: RowMapping) -> Terms:
    return Terms(
        monthly_rate_bps=row["monthly_rate_bps"],
        interest_mode=row["interest_mode"],
        part_month_rule=row["part_month_rule"],
    )


def _allocations_to(
    conn: Connection, mortgage_ids: list[int]
) -> dict[int, list[Allocation]]:
    """Every Payment Allocation to each of these Mortgages, as ledger events."""
    rows = conn.execute(
        select(
            allocation_table.c.mortgage_id,
            allocation_table.c.amount,
            allocation_table.c.payment_id,
            payment_table.c.paid_on,
        )
        .join(payment_table, payment_table.c.id == allocation_table.c.payment_id)
        .where(allocation_table.c.mortgage_id.in_(mortgage_ids))
    )
    found: dict[int, list[Allocation]] = {
        mortgage_id: [] for mortgage_id in mortgage_ids
    }
    for row in rows:
        found[row.mortgage_id].append(
            Allocation(on=row.paid_on, amount=row.amount, payment_id=row.payment_id)
        )
    return found


def ledgers_of(
    conn: Connection, rows: Sequence[RowMapping], as_of: date
) -> dict[int, list[LedgerStep]]:
    """Each Mortgage row's Ledger up to `as_of`, replaying its Payment Allocations.

    Raises Overpayment if any Allocation is larger than what was owed on its date.
    """
    allocations = _allocations_to(conn, [row["id"] for row in rows])
    return {
        row["id"]: compute_ledger(
            row["start_date"],
            row["amount_lent"],
            _terms(row),
            as_of,
            allocations[row["id"]],
        )
        for row in rows
    }


def _outstanding_of(ledger: list[LedgerStep]) -> Outstanding:
    last = ledger[-1]
    return Outstanding(
        principal=last.principal,
        unpaid_interest=last.unpaid_interest,
        total=last.principal + last.unpaid_interest,
    )


def _select_with_customer() -> Select[Any]:
    """Mortgages joined to their Customer's name."""
    return select(mortgage_table, customer_table.c.name.label("customer_name")).join(
        customer_table, customer_table.c.id == mortgage_table.c.customer_id
    )


def _customer_of(row: RowMapping) -> PersonSummary:
    return PersonSummary(
        kind="customer", id=row["customer_id"], name=row["customer_name"]
    )


def _load_mortgage(conn: Connection, mortgage_id: int, today: date) -> Mortgage:
    row = (
        conn.execute(_select_with_customer().where(mortgage_table.c.id == mortgage_id))
        .mappings()
        .first()
    )
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Mortgage not found")
    photos = conn.execute(
        select(mortgage_photo_table)
        .where(mortgage_photo_table.c.mortgage_id == mortgage_id)
        .order_by(mortgage_photo_table.c.id)
    )
    ledger = ledgers_of(conn, [row], today)[mortgage_id]
    return Mortgage(
        id=row["id"],
        name=row["name"],
        customer=_customer_of(row),
        start_date=row["start_date"],
        amount_lent=row["amount_lent"],
        description=row["description"],
        gross_weight_mg=row["gross_weight_mg"],
        net_weight_mg=row["net_weight_mg"],
        purity_karat=row["purity_karat"],
        terms=_terms(row),
        status=row["status"],
        photos=[MortgagePhoto(id=p.id, url=photo_url(p.file) or "") for p in photos],
        as_of=today,
        ledger=ledger,
        outstanding=_outstanding_of(ledger),
    )


_FILLER = {"a", "an", "and", "the", "with", "of", "in", "on", "for"}


def _camel_words(text: str, limit: int) -> str:
    """ "gold chain, 22K" → "GoldChain22K"."""
    words = [w for w in re.findall(r"[A-Za-z0-9]+", text) if w.lower() not in _FILLER][
        :limit
    ]
    return "".join(word[0].upper() + word[1:] for word in words)


def _unique_name(conn: Connection, name: str) -> str:
    """The name itself if free, else the first free `name-2`, `name-3`, …"""
    taken = {
        taken_name.lower()
        for taken_name in conn.execute(
            select(mortgage_table.c.name).where(
                or_(
                    func.lower(mortgage_table.c.name) == name.lower(),
                    mortgage_table.c.name.ilike(f"{name}-%"),
                )
            )
        ).scalars()
    }
    candidate, n = name, 2
    while candidate.lower() in taken:
        candidate, n = f"{name}-{n}", n + 1
    return candidate


def _suggest_name(
    conn: Connection, customer_name: str, start_date: date, description: str
) -> str:
    parts = [
        str(start_date.year),
        _camel_words(customer_name, 1),
        _camel_words(description, 3),
    ]
    return _unique_name(conn, "-".join(part for part in parts if part))


def _customer_name(conn: Connection, customer_id: int) -> str:
    name: str | None = conn.execute(
        select(customer_table.c.name).where(customer_table.c.id == customer_id)
    ).scalar()
    if name is None:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Customer not found")
    return name


router = APIRouter(prefix="/api")


@router.get("/mortgages/suggested-name")
def suggested_name(
    customer_id: int, start_date: date, description: str, engine: EngineDep
) -> dict[str, str]:
    with engine.connect() as conn:
        return {
            "name": _suggest_name(
                conn, _customer_name(conn, customer_id), start_date, description
            )
        }


@router.post("/mortgages", status_code=status.HTTP_201_CREATED)
def create_mortgage(
    mortgage: MortgageIn, engine: EngineDep, today: TodayDep
) -> Mortgage:
    if mortgage.start_date > today:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT, "Start date cannot be in the future"
        )
    with engine.begin() as conn:
        customer_name = _customer_name(conn, mortgage.customer_id)
        if mortgage.name is None:
            name = _suggest_name(
                conn, customer_name, mortgage.start_date, mortgage.description
            )
        elif _unique_name(conn, mortgage.name) != mortgage.name:
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                f"The Mortgage Name {mortgage.name} is already used",
            )
        else:
            name = mortgage.name
        terms = mortgage.terms or get_default_terms(conn)
        mortgage_id = conn.execute(
            insert(mortgage_table)
            .values(
                **mortgage.model_dump(exclude={"name", "terms"}),
                **terms.model_dump(),
                name=name,
            )
            .returning(mortgage_table.c.id)
        ).scalar_one()
        return _load_mortgage(conn, mortgage_id, today)


@router.get("/mortgages/{mortgage_id}")
def read_mortgage(mortgage_id: int, engine: EngineDep, today: TodayDep) -> Mortgage:
    with engine.connect() as conn:
        return _load_mortgage(conn, mortgage_id, today)


PAGE_SIZE = 20


@router.get("/mortgages")
def list_mortgages(
    engine: EngineDep,
    today: TodayDep,
    page: Annotated[int, Query(ge=1)] = 1,
    q: str = "",
    customer_id: int | None = None,
    mortgage_status: Annotated[MortgageStatus | None, Query(alias="status")] = None,
    as_of: date | None = None,
) -> MortgagePage:
    """Mortgages, newest first, filtered by Mortgage Name or Customer name.

    With `as_of`, only Mortgages started by then, with what they owed on that date
    (used when recording a back-dated Payment).
    """
    if as_of is not None and as_of > today:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT, "The date cannot be in the future"
        )
    query = q.strip()
    match = (
        or_(
            mortgage_table.c.name.icontains(query),
            customer_table.c.name.icontains(query),
        )
        if query
        else true()
    )
    if customer_id is not None:
        match = match & (mortgage_table.c.customer_id == customer_id)
    if as_of is not None:
        match = match & (mortgage_table.c.start_date <= as_of)
    if mortgage_status is not None:
        match = match & (mortgage_table.c.status == mortgage_status)
    with engine.connect() as conn:
        total = conn.execute(
            select(func.count())
            .select_from(mortgage_table.join(customer_table))
            .where(match)
        ).scalar_one()
        rows = (
            conn.execute(
                _select_with_customer()
                .where(match)
                .order_by(mortgage_table.c.start_date.desc(), mortgage_table.c.name)
                .limit(PAGE_SIZE)
                .offset((page - 1) * PAGE_SIZE)
            )
            .mappings()
            .all()
        )
        ledgers = ledgers_of(conn, rows, as_of or today)
        items = [
            MortgageRow(
                id=row["id"],
                name=row["name"],
                customer=_customer_of(row),
                start_date=row["start_date"],
                amount_lent=row["amount_lent"],
                status=row["status"],
                outstanding_total=_outstanding_of(ledgers[row["id"]]).total,
            )
            for row in rows
        ]
    return MortgagePage(items=items, total=total, page=page, page_size=PAGE_SIZE)


@router.post("/mortgages/{mortgage_id}/photos")
async def add_mortgage_photo(
    mortgage_id: int,
    photo: UploadFile,
    engine: EngineDep,
    photos_dir: PhotosDirDep,
    today: TodayDep,
) -> Mortgage:
    with engine.connect() as conn:
        if not exists(conn, mortgage_table, mortgage_id):
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Mortgage not found")
    file_name = save_photo(photos_dir, "mortgage", mortgage_id, await photo.read())
    with engine.begin() as conn:
        conn.execute(
            insert(mortgage_photo_table).values(mortgage_id=mortgage_id, file=file_name)
        )
        return _load_mortgage(conn, mortgage_id, today)


@router.delete("/mortgages/{mortgage_id}/photos/{photo_id}")
def delete_mortgage_photo(
    mortgage_id: int,
    photo_id: int,
    engine: EngineDep,
    photos_dir: PhotosDirDep,
    today: TodayDep,
) -> Mortgage:
    with engine.begin() as conn:
        file_name = conn.execute(
            select(mortgage_photo_table.c.file).where(
                mortgage_photo_table.c.id == photo_id,
                mortgage_photo_table.c.mortgage_id == mortgage_id,
            )
        ).scalar()
        if file_name is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Photo not found")
        conn.execute(
            delete(mortgage_photo_table).where(mortgage_photo_table.c.id == photo_id)
        )
        mortgage = _load_mortgage(conn, mortgage_id, today)
    delete_photo(photos_dir, file_name)
    return mortgage
