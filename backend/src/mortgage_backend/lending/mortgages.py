"""Mortgages: one loan against one pledged packet of jewellery (see GLOSSARY.md)."""

import re
from collections.abc import Callable, Mapping, Sequence
from datetime import date
from typing import Annotated, Any, Literal

from fastapi import APIRouter, HTTPException, Query, status
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import (
    Select,
    case,
    false,
    func,
    or_,
    select,
    true,
)
from sqlalchemy.engine import Connection, RowMapping

from mortgage_backend.collateral.collateral import (
    Collateral,
    Purity,
    collateral_of,
    gold_rates,
)
from mortgage_backend.lending.ledger import (
    LedgerStep,
    accrual_date,
)
from mortgage_backend.lending.replay import (
    MortgageReplay,
    MortgageStatus,
    Outstanding,
    replays,
)
from mortgage_backend.lending.terms import Terms
from mortgage_backend.people.customers import PersonSummary, phone_fragment
from mortgage_backend.platform.clock import MonthQuery, TodayDep, month_span
from mortgage_backend.platform.db import (
    EngineDep,
    customer_table,
    mortgage_photo_table,
    mortgage_table,
)
from mortgage_backend.platform.errors import unprocessable
from mortgage_backend.platform.paging import (
    Page,
    PageNumber,
    Sorting,
    query_page,
    rows_page,
)
from mortgage_backend.platform.photos import photo_url


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


class Closure(BaseModel):
    """How and when a Mortgage was closed."""

    kind: Literal["redeemed", "waived", "forfeited"]
    on: date
    redemption_amount: int  # owed on that date, Part-Month Rule charge included
    payment_id: int | None  # Redeemed or Waived: the final Payment, if any
    waived_amount: int | None  # Waived: what the Lender let off
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
    last = mortgage.ledger(row["closed_on"])[-1]
    return Closure(
        kind=row["status"],
        on=row["closed_on"],
        redemption_amount=redemption_amount,
        payment_id=row["redemption_payment_id"],
        waived_amount=last.amount if last.event == "waived" else None,
        recovered_amount=row["recovered_amount"],
        profit_loss=row["recovered_amount"] - redemption_amount if forfeited else None,
        note=row["closure_note"],
    )


def mortgage_rows(
    conn: Connection,
    rows: Sequence[RowMapping],
    as_of: date,
    replayed: Mapping[int, MortgageReplay] | None = None,
) -> list[MortgageRow]:
    """Rows from select_with_customer() as listed in tables, Outstanding as of `as_of`;
    from `replayed` when the caller has replayed them already."""
    if replayed is None:
        replayed = replays(conn, rows)
    return [
        MortgageRow(
            id=row["id"],
            name=row["name"],
            customer=_customer_of(row),
            start_date=row["start_date"],
            amount_lent=row["amount_lent"],
            status=row["status"],
            outstanding_total=replayed[row["id"]].outstanding(as_of).total,
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


def name_for(conn: Connection, mortgage: MortgageIn) -> str:
    """The new Mortgage's Mortgage Name: the one given, or one suggested from its
    Customer, year and jewellery; refused for an unknown Customer or a name in use."""
    customer_name = _customer_name(conn, mortgage.customer_id)
    if mortgage.name is None:
        return _suggest_name(
            conn, customer_name, mortgage.start_date, mortgage.description
        )
    if _unique_name(conn, mortgage.name) != mortgage.name:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"The Mortgage Name {mortgage.name} is already used",
        )
    return mortgage.name


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


@router.get("/mortgages/{mortgage_id}")
def read_mortgage(mortgage_id: int, engine: EngineDep, today: TodayDep) -> Mortgage:
    with engine.connect() as conn:
        return load_mortgage(conn, mortgage_id, today)


# A column of the Mortgages list to sort it by.
MortgageSort = Literal["name", "customer", "started", "lent", "outstanding", "status"]

# Each stored column, newest first otherwise; Outstanding is computed, so it is sorted
# after the replay.
_SORTING = Sorting[MortgageSort](
    columns={
        "name": func.lower(mortgage_table.c.name),
        "customer": func.lower(customer_table.c.name),
        "started": mortgage_table.c.start_date,
        "lent": mortgage_table.c.amount_lent,
        # In their lifecycle order, not alphabetical.
        "status": case(
            {
                MortgageStatus.ACTIVE: 0,
                MortgageStatus.REDEEMED: 1,
                MortgageStatus.WAIVED: 2,
            },
            value=mortgage_table.c.status,
            else_=3,
        ),
    },
    default_order=[
        mortgage_table.c.start_date.desc(),
        mortgage_table.c.name.asc(),
        mortgage_table.c.id.asc(),
    ],
)
# Outstanding is computed, so the rows are sorted by it after the replay.
_SORT_AFTER_REPLAY: dict[MortgageSort, Callable[[MortgageRow], int]] = {
    "outstanding": lambda row: row.outstanding_total
}


@router.get("/mortgages")
def list_mortgages(
    engine: EngineDep,
    today: TodayDep,
    page: PageNumber = 1,
    q: str = "",
    customer_id: int | None = None,
    mortgage_status: Annotated[MortgageStatus | None, Query(alias="status")] = None,
    as_of: date | None = None,
    owing: bool = False,
    closed_in: MonthQuery = None,
    closed: bool = False,
    paged: bool = True,
    sort: MortgageSort | None = None,
    descending: bool = False,
) -> Page[MortgageRow]:
    """Mortgages, newest first (or by `sort`, reversed when `descending`), filtered by
    Mortgage Name, Customer name or (part of) the Customer's Primary Number.

    With `as_of`, only Mortgages started by then, with what they owed on that date
    (used when recording a back-dated Payment). With `owing`, only those with something
    Outstanding (Outstanding is computed, so that filter is applied after the replay).
    With `closed_in` (YYYY-MM), only those closed that month; with `closed`, only those
    closed (Redeemed, Waived or Forfeited). With `paged` false, every match on one
    page: for pickers, such as a Payment's Allocations, which must never leave a
    Mortgage out.
    """
    if as_of is not None and as_of > today:
        raise unprocessable("The date cannot be in the future")
    query = q.strip()
    # Digits may be part of a Mortgage Name (its year) as well as of a phone number.
    phone = phone_fragment(query)
    match = (
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
    if mortgage_status is not None:
        match = match & (mortgage_table.c.status == mortgage_status)
    if closed:
        match = match & (mortgage_table.c.status != MortgageStatus.ACTIVE)
    if closed_in is not None:
        match = match & mortgage_table.c.closed_on.between(*month_span(closed_in))
    after_replay = sort if sort in _SORT_AFTER_REPLAY else None
    by_column = None if after_replay else sort
    matching = select_with_customer().where(match)
    with engine.connect() as conn:
        if owing or not paged or after_replay:
            # Outstanding is computed, so these are listed after the replay.
            rows = (
                conn.execute(
                    matching.order_by(*_SORTING.order(by_column, descending))
                )
                .mappings()
                .all()
            )
            listed = [
                row
                for row in mortgage_rows(conn, rows, as_of or today)
                if row.outstanding_total > 0 or not owing
            ]
            return rows_page(
                listed,
                page if paged else None,  # unpaged: every match, for pickers
                _SORT_AFTER_REPLAY,
                sort=after_replay,
                descending=descending,
            )
        return query_page(
            conn,
            matching,
            _SORTING,
            page,
            lambda rows: mortgage_rows(conn, rows, as_of or today),
            sort=by_column,
            descending=descending,
        )
