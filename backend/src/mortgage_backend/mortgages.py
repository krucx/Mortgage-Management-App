"""Mortgages: one loan against one pledged packet of jewellery (see GLOSSARY.md)."""

import re
from collections.abc import Sequence
from datetime import date, datetime
from typing import Annotated, Any, Literal

from fastapi import APIRouter, HTTPException, Query, UploadFile, status
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import Select, delete, func, insert, or_, select, true, update
from sqlalchemy.engine import Connection, RowMapping

from mortgage_backend import audit
from mortgage_backend.clock import NowDep, TodayDep
from mortgage_backend.collateral import Collateral, Purity, collateral_of, gold_rates
from mortgage_backend.customers import PersonSummary
from mortgage_backend.db import (
    EngineDep,
    customer_table,
    exists,
    mortgage_photo_table,
    mortgage_table,
)
from mortgage_backend.default_terms import get_default_terms
from mortgage_backend.errors import unprocessable
from mortgage_backend.ledger import (
    LedgerStep,
    Overpayment,
    accrual_date,
    is_accrual_date,
)
from mortgage_backend.money import format_inr
from mortgage_backend.photos import PhotosDirDep, delete_photo, photo_url, save_photo
from mortgage_backend.replay import (
    MortgageReplay,
    MortgageStatus,
    Outstanding,
    mortgage_row,
    replay,
    replays,
)
from mortgage_backend.terms import Terms


class MortgageDetails(BaseModel):
    """What the Lender records about a Mortgage, apart from its Customer and Terms."""

    name: str | None = None  # Mortgage Name; suggested when left out
    start_date: date
    amount_lent: int = Field(gt=0)  # paise; the starting Principal
    description: str
    gross_weight_mg: int = Field(gt=0)
    net_weight_mg: int = Field(gt=0)  # gold only, after stones
    purity_karat: Purity

    @model_validator(mode="after")
    def check(self) -> "MortgageDetails":
        if self.net_weight_mg > self.gross_weight_mg:
            raise ValueError("net weight cannot exceed gross weight")
        if self.name is not None:
            self.name = self.name.strip()
            if not re.fullmatch(rf"{self.start_date.year}-\S.*", self.name):
                raise ValueError(
                    f"Mortgage Name must start with {self.start_date.year}-"
                )
        return self


class MortgageIn(MortgageDetails):
    customer_id: int
    terms: Terms | None = None  # None: copy the Default Terms


class MortgageEdit(MortgageDetails):
    name: str


# Changing these on a closed Mortgage would contradict how it was closed.
_LOCKED_WHEN_CLOSED = ["start_date", "amount_lent"]
_AUDITED = [
    "name",
    "start_date",
    "amount_lent",
    "description",
    "gross_weight_mg",
    "net_weight_mg",
    "purity_karat",
]
_AUDITED_ON_CREATE = [
    "customer_id",
    *_AUDITED,
    "monthly_rate_bps",
    "interest_mode",
    "part_month_rule",
]


class MortgagePhoto(BaseModel):
    id: int
    url: str


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


class Closure(BaseModel):
    """How and when a Mortgage was closed."""

    kind: Literal["redeemed", "forfeited"]
    on: date
    redemption_amount: int  # owed on that date, Part-Month Rule charge included
    payment_id: int | None  # Redeemed: the final Payment, if anything was owed
    recovered_amount: int | None  # Forfeited: what the jewellery fetched (or is worth)
    profit_loss: int | None  # Forfeited: recovered − Redemption Amount
    note: str | None


class TermChangeOut(BaseModel):
    id: int
    effective_on: date  # an Accrual Date
    terms: Terms  # in force from then on, earlier Term Changes included
    removable: bool  # until it takes effect


def upcoming_accrual_dates(start: date, today: date, count: int = 12) -> list[date]:
    """The next `count` Accrual Dates, today included."""
    n = 1
    while accrual_date(start, n) < today:
        n += 1
    return [accrual_date(start, n + i) for i in range(count)]


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
    purity_karat: Purity
    terms: Terms  # in force today
    term_changes: list[TermChangeOut]
    upcoming_accrual_dates: list[date]  # when a Term Change could start
    status: MortgageStatus
    photos: list[MortgagePhoto]
    as_of: date
    ledger: list[LedgerStep]
    outstanding: Outstanding
    collateral: Collateral | None  # None until a Gold Rate or manual value is set
    closure: Closure | None


def _closure(mortgage: MortgageReplay) -> Closure | None:
    row = mortgage.row
    if row["status"] == MortgageStatus.ACTIVE:
        return None
    redemption_amount = mortgage.redemption(row["closed_on"]).total
    forfeited = row["status"] == MortgageStatus.FORFEITED
    return Closure(
        kind=row["status"],
        on=row["closed_on"],
        redemption_amount=redemption_amount,
        payment_id=row["redemption_payment_id"],
        recovered_amount=row["recovered_amount"],
        profit_loss=row["recovered_amount"] - redemption_amount if forfeited else None,
        note=row["closure_note"],
    )


def mortgage_rows(
    conn: Connection, rows: Sequence[RowMapping], as_of: date
) -> list[MortgageRow]:
    """Rows from select_with_customer() as listed in tables, Outstanding as of `as_of`."""
    found = replays(conn, rows)
    return [
        MortgageRow(
            id=row["id"],
            name=row["name"],
            customer=_customer_of(row),
            start_date=row["start_date"],
            amount_lent=row["amount_lent"],
            status=row["status"],
            outstanding_total=found[row["id"]].outstanding(as_of).total,
        )
        for row in rows
    ]


def select_with_customer() -> Select[Any]:
    """Mortgages joined to their Customer's name."""
    return select(mortgage_table, customer_table.c.name.label("customer_name")).join(
        customer_table, customer_table.c.id == mortgage_table.c.customer_id
    )


def _customer_of(row: RowMapping) -> PersonSummary:
    return PersonSummary(
        kind="customer", id=row["customer_id"], name=row["customer_name"]
    )


def load_mortgage(conn: Connection, mortgage_id: int, today: date) -> Mortgage:
    row = (
        conn.execute(select_with_customer().where(mortgage_table.c.id == mortgage_id))
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
    mortgage = replays(conn, [row])[mortgage_id]
    outstanding = mortgage.outstanding(today)
    active = row["status"] == MortgageStatus.ACTIVE
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
        terms=mortgage.terms_on(today),
        term_changes=[
            TermChangeOut(
                id=change.id or 0,
                effective_on=change.on,
                terms=mortgage.terms_on(change.on),
                removable=active and change.on > today,
            )
            for change in mortgage.term_changes
        ],
        upcoming_accrual_dates=(
            upcoming_accrual_dates(row["start_date"], today) if active else []
        ),
        status=row["status"],
        photos=[MortgagePhoto(id=p.id, url=photo_url(p.file) or "") for p in photos],
        as_of=today,
        ledger=mortgage.ledger(today),
        outstanding=outstanding,
        collateral=collateral_of(row, gold_rates(conn), outstanding.total),
        closure=_closure(mortgage),
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
        raise unprocessable("Customer not found")
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
    mortgage: MortgageIn, engine: EngineDep, today: TodayDep, now: NowDep
) -> Mortgage:
    if mortgage.start_date > today:
        raise unprocessable("Start date cannot be in the future")
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
        audit.record(
            conn,
            now,
            "mortgage",
            mortgage_id,
            "created",
            audit.created(mortgage_row(conn, mortgage_id), _AUDITED_ON_CREATE),
        )
        return load_mortgage(conn, mortgage_id, today)


@router.get("/mortgages/{mortgage_id}")
def read_mortgage(mortgage_id: int, engine: EngineDep, today: TodayDep) -> Mortgage:
    with engine.connect() as conn:
        return load_mortgage(conn, mortgage_id, today)


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
    owing: bool = False,
) -> MortgagePage:
    """Mortgages, newest first, filtered by Mortgage Name or Customer name.

    With `as_of`, only Mortgages started by then, with what they owed on that date
    (used when recording a back-dated Payment). With `owing`, only those with something
    Outstanding (Outstanding is computed, so that filter is applied after the replay).
    """
    if as_of is not None and as_of > today:
        raise unprocessable("The date cannot be in the future")
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
    newest_first = (
        select_with_customer()
        .where(match)
        .order_by(mortgage_table.c.start_date.desc(), mortgage_table.c.name)
    )
    start = (page - 1) * PAGE_SIZE
    with engine.connect() as conn:
        if owing:
            rows = conn.execute(newest_first).mappings().all()
            owed = [
                row
                for row in mortgage_rows(conn, rows, as_of or today)
                if row.outstanding_total > 0
            ]
            return MortgagePage(
                items=owed[start : start + PAGE_SIZE],
                total=len(owed),
                page=page,
                page_size=PAGE_SIZE,
            )
        total = conn.execute(
            select(func.count())
            .select_from(mortgage_table.join(customer_table))
            .where(match)
        ).scalar_one()
        rows = (
            conn.execute(newest_first.limit(PAGE_SIZE).offset(start)).mappings().all()
        )
        items = mortgage_rows(conn, rows, as_of or today)
    return MortgagePage(items=items, total=total, page=page, page_size=PAGE_SIZE)


@router.post("/mortgages/{mortgage_id}/photos")
async def add_mortgage_photo(
    mortgage_id: int,
    photo: UploadFile,
    engine: EngineDep,
    photos_dir: PhotosDirDep,
    today: TodayDep,
    now: NowDep,
) -> Mortgage:
    with engine.connect() as conn:
        if not exists(conn, mortgage_table, mortgage_id):
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Mortgage not found")
    file_name = save_photo(photos_dir, "mortgage", mortgage_id, await photo.read())
    with engine.begin() as conn:
        conn.execute(
            insert(mortgage_photo_table).values(mortgage_id=mortgage_id, file=file_name)
        )
        audit.record(conn, now, "mortgage", mortgage_id, "photo_added")
        return load_mortgage(conn, mortgage_id, today)


@router.delete("/mortgages/{mortgage_id}/photos/{photo_id}")
def delete_mortgage_photo(
    mortgage_id: int,
    photo_id: int,
    engine: EngineDep,
    photos_dir: PhotosDirDep,
    today: TodayDep,
    now: NowDep,
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
        audit.record(conn, now, "mortgage", mortgage_id, "photo_removed")
        mortgage = load_mortgage(conn, mortgage_id, today)
    delete_photo(photos_dir, file_name)
    return mortgage


class CollateralIn(BaseModel):
    value: int | None = Field(default=None, gt=0)  # paise; None: the Gold Rate again


@router.put("/mortgages/{mortgage_id}/collateral")
def set_collateral(
    mortgage_id: int,
    collateral: CollateralIn,
    engine: EngineDep,
    today: TodayDep,
    now: NowDep,
) -> Mortgage:
    """Set the Collateral Value by hand, or clear it to value at the Gold Rate again."""
    with engine.begin() as conn:
        before = mortgage_row(conn, mortgage_id)
        conn.execute(
            mortgage_table.update()
            .where(mortgage_table.c.id == mortgage_id)
            .values(
                collateral_override=collateral.value,
                collateral_override_on=today if collateral.value else None,
            )
        )
        changed = audit.changes(
            before, {"collateral_override": collateral.value}, ["collateral_override"]
        )
        if changed:
            audit.record(conn, now, "mortgage", mortgage_id, "edited", changed)
        return load_mortgage(conn, mortgage_id, today)


def apply_edit(
    conn: Connection, mortgage_id: int, edit: MortgageEdit, today: date, now: datetime
) -> None:
    """Correct a Mortgage's details (or refuse); the Ledger follows from them."""
    if edit.start_date > today:
        raise unprocessable("Start date cannot be in the future")
    before = mortgage_row(conn, mortgage_id)
    after = edit.model_dump()
    changed = audit.changes(before, after, _AUDITED)
    if before["status"] != MortgageStatus.ACTIVE and any(
        c.field in _LOCKED_WHEN_CLOSED for c in changed
    ):
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"{before['name']} is {before['status']}: reopen it to change its "
            "start date or Principal",
        )
    taken = conn.execute(
        select(mortgage_table.c.id).where(
            func.lower(mortgage_table.c.name) == edit.name.lower(),
            mortgage_table.c.id != mortgage_id,
        )
    ).first()
    if taken:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"The Mortgage Name {edit.name} is already used",
        )
    mortgage = replay(conn, mortgage_id)
    first_payment = min((a.on for a in mortgage.allocations), default=None)
    stranded = [
        c.on
        for c in mortgage.term_changes
        if not is_accrual_date(edit.start_date, c.on)
    ]
    if stranded:
        raise unprocessable(
            f"The Term Change from {stranded[0]:%d %b %Y} would no longer be on an "
            "Accrual Date: keep the same day of the month, or remove it first"
        )
    if first_payment is not None and edit.start_date > first_payment:
        raise unprocessable(
            f"There is a Payment on {first_payment:%d %b %Y}, before that start date"
        )
    conn.execute(
        update(mortgage_table).where(mortgage_table.c.id == mortgage_id).values(**after)
    )
    try:
        replay(conn, mortgage_id).ledger(today)
    except Overpayment as over:
        raise unprocessable(
            f"The Payment on {over.on:%d %b %Y} would then be more than the "
            f"{format_inr(over.outstanding)} owed"
        ) from None
    if changed:
        audit.record(conn, now, "mortgage", mortgage_id, "edited", changed)


@router.put("/mortgages/{mortgage_id}")
def edit_mortgage(
    mortgage_id: int,
    edit: MortgageEdit,
    engine: EngineDep,
    today: TodayDep,
    now: NowDep,
) -> Mortgage:
    """Correct a Mortgage's details; its Ledger is recalculated from them."""
    with engine.begin() as conn:
        apply_edit(conn, mortgage_id, edit, today, now)
        return load_mortgage(conn, mortgage_id, today)
