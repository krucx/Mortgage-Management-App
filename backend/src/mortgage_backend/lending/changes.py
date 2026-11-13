"""Changes to Mortgages that stay in lending: creating a Mortgage, correcting its
details, and adding and removing Term Changes. Payments are in payments/, Closures in
lending/closing.py, and Collateral Values and photos in collateral/.

Every change is refused if it isn't allowed, written, then checked by replaying each
Mortgage whose Ledger it touches (no Payment may end up larger than what was owed on its
date), and then recorded in History. The request handlers only parse, call and answer; Previews make the
same change and roll it back.
"""

from datetime import date, datetime

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import delete, func, insert, select, update
from sqlalchemy.engine import Connection

from mortgage_backend.lending.default_terms import DEFAULT_TERMS
from mortgage_backend.lending.ledger import is_accrual_date
from mortgage_backend.lending.mortgages import (
    Mortgage,
    MortgageEdit,
    MortgageIn,
    load_mortgage,
    name_for,
    upcoming_accrual_dates,
)
from mortgage_backend.lending.refusals import check_replays, refuse_unless_active
from mortgage_backend.lending.replay import MortgageStatus, mortgage_row, replay
from mortgage_backend.lending.terms import InterestMode, PartMonthRule, Terms
from mortgage_backend.platform.clock import NowDep, TodayDep
from mortgage_backend.platform.db import EngineDep, mortgage_table, term_change_table
from mortgage_backend.platform.errors import unprocessable
from mortgage_backend.safekeeping import audit


class TermChangeIn(BaseModel):
    """What changes; anything left out carries over from the Terms in force then."""

    effective_on: date | None = None  # an Accrual Date; None: the next one
    monthly_rate_bps: int | None = Field(default=None, gt=0, le=10_000)
    interest_mode: InterestMode | None = None
    part_month_rule: PartMonthRule | None = None


# Changing these on a closed Mortgage would contradict how it was closed.
_LOCKED_WHEN_CLOSED = {
    "start_date": "start date",
    "amount_lent": "Principal",
    "monthly_rate_bps": "Terms",
    "interest_mode": "Terms",
    "part_month_rule": "Terms",
}
_AUDITED_EDITS = [
    "name",
    "start_date",
    "amount_lent",
    "description",
    "gross_weight_mg",
    "net_weight_mg",
    "purity_karat",
    "lent_through",
    "monthly_rate_bps",
    "interest_mode",
    "part_month_rule",
]


def _join(items: list[str]) -> str:
    """ "start date", "Principal" and "Terms" -> "start date, Principal or Terms"."""
    if len(items) == 1:
        return items[0]
    return ", ".join(items[:-1]) + " or " + items[-1]


def add_term_change(
    conn: Connection, mortgage_id: int, change: TermChangeIn, today: date, now: datetime
) -> None:
    """Add a Term Change (or refuse)."""
    mortgage = replay(conn, mortgage_id)
    row = mortgage.row
    refuse_unless_active(row)
    next_one = next(
        d for d in upcoming_accrual_dates(row["start_date"], today) if d > today
    )
    effective_on = change.effective_on or next_one
    if effective_on < today or not is_accrual_date(row["start_date"], effective_on):
        raise unprocessable(
            "A Term Change starts on an Accrual Date, today or later "
            f"(the next is {next_one:%d %b %Y})"
        )
    if any(c.on == effective_on for c in mortgage.term_changes):
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"There is already a Term Change on {effective_on:%d %b %Y}",
        )
    before = mortgage.terms_on(effective_on)
    # Only what differs is stored, so a later Term Change keeps its own effect.
    changed = audit.changes(
        before.model_dump(),
        {**before.model_dump(), **change.model_dump(exclude_none=True)},
        Terms.model_fields,
    )
    if not changed:
        raise unprocessable("The Term Change must change the rate, mode or rule")
    conn.execute(
        insert(term_change_table).values(
            mortgage_id=mortgage_id,
            effective_on=effective_on,
            **{c.field: getattr(change, c.field) for c in changed},
        )
    )
    check_replays(conn, [row], today)
    audit.record(
        conn,
        now,
        "mortgage",
        mortgage_id,
        "term_change_added",
        [
            audit.Change("effective_on", None, effective_on.isoformat()),
            *changed,
        ],
    )


def edit_mortgage(
    conn: Connection, mortgage_id: int, edit: MortgageEdit, today: date, now: datetime
) -> None:
    """Correct a Mortgage's details (or refuse); the Ledger follows from them."""
    if edit.start_date > today:
        raise unprocessable("Start date cannot be in the future")
    mortgage = replay(conn, mortgage_id)
    before = mortgage.row
    after = edit.model_dump(exclude={"terms"})
    after.update(
        edit.terms.model_dump()
        if edit.terms
        else {
            field: before[field]
            for field in ("monthly_rate_bps", "interest_mode", "part_month_rule")
        }
    )
    if after["lent_through"] is None:  # left out: kept, never cleared
        after["lent_through"] = before["lent_through"]
    changed = audit.changes(before, after, _AUDITED_EDITS)
    locked = dict.fromkeys(
        _LOCKED_WHEN_CLOSED[c.field] for c in changed if c.field in _LOCKED_WHEN_CLOSED
    )
    if before["status"] != MortgageStatus.ACTIVE and locked:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"{before['name']} is {before['status']}: reopen it to change its "
            + _join(list(locked)),
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
    first_payment = min((a.on for a in mortgage.allocations), default=None)
    if first_payment is not None and edit.start_date > first_payment:
        raise unprocessable(
            f"There is a Payment on {first_payment:%d %b %Y}, before that start date"
        )
    conn.execute(
        update(mortgage_table).where(mortgage_table.c.id == mortgage_id).values(**after)
    )
    check_replays(conn, [mortgage_row(conn, mortgage_id)], today)
    if changed:
        audit.record(conn, now, "mortgage", mortgage_id, "edited", changed)


_AUDITED_ON_CREATE = [
    "customer_id",
    "name",
    "start_date",
    "amount_lent",
    "description",
    "gross_weight_mg",
    "net_weight_mg",
    "purity_karat",
    "lent_through",
    "monthly_rate_bps",
    "interest_mode",
    "part_month_rule",
]


def create_mortgage(
    conn: Connection, mortgage: MortgageIn, today: date, now: datetime
) -> int:
    """Lend against a packet of jewellery (or refuse): named if no name is given, on
    the Default Terms if none are."""
    if mortgage.start_date > today:
        raise unprocessable("Start date cannot be in the future")
    name = name_for(conn, mortgage)
    terms = mortgage.terms or DEFAULT_TERMS.get(conn)
    mortgage_id: int = conn.execute(
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
    return mortgage_id


def remove_term_change(
    conn: Connection, mortgage_id: int, change_id: int, today: date, now: datetime
) -> None:
    """Remove a Term Change that has not taken effect yet (or refuse)."""
    row = mortgage_row(conn, mortgage_id)
    refuse_unless_active(row)
    effective_on = conn.execute(
        select(term_change_table.c.effective_on).where(
            term_change_table.c.id == change_id,
            term_change_table.c.mortgage_id == mortgage_id,
        )
    ).scalar()
    if effective_on is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Term Change not found")
    if effective_on <= today:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "This Term Change has taken effect; add another to change the Terms",
        )
    conn.execute(delete(term_change_table).where(term_change_table.c.id == change_id))
    check_replays(conn, [row], today)
    audit.record(
        conn,
        now,
        "mortgage",
        mortgage_id,
        "term_change_removed",
        note=f"from {effective_on:%d %b %Y}",
    )


router = APIRouter(prefix="/api")


@router.post(
    "/mortgages/{mortgage_id}/term-changes", status_code=status.HTTP_201_CREATED
)
def post_term_change(
    mortgage_id: int,
    change: TermChangeIn,
    engine: EngineDep,
    today: TodayDep,
    now: NowDep,
) -> Mortgage:
    with engine.begin() as conn:
        add_term_change(conn, mortgage_id, change, today, now)
        return load_mortgage(conn, mortgage_id, today)


@router.put("/mortgages/{mortgage_id}")
def put_mortgage(
    mortgage_id: int,
    edit: MortgageEdit,
    engine: EngineDep,
    today: TodayDep,
    now: NowDep,
) -> Mortgage:
    """Correct a Mortgage's details; its Ledger is replayed from them."""
    with engine.begin() as conn:
        edit_mortgage(conn, mortgage_id, edit, today, now)
        return load_mortgage(conn, mortgage_id, today)


@router.delete("/mortgages/{mortgage_id}/term-changes/{change_id}")
def delete_term_change(
    mortgage_id: int,
    change_id: int,
    engine: EngineDep,
    today: TodayDep,
    now: NowDep,
) -> Mortgage:
    """Remove a Term Change that has not taken effect yet."""
    with engine.begin() as conn:
        remove_term_change(conn, mortgage_id, change_id, today, now)
        return load_mortgage(conn, mortgage_id, today)


@router.post("/mortgages", status_code=status.HTTP_201_CREATED)
def post_mortgage(
    mortgage: MortgageIn, engine: EngineDep, today: TodayDep, now: NowDep
) -> Mortgage:
    with engine.begin() as conn:
        mortgage_id = create_mortgage(conn, mortgage, today, now)
        return load_mortgage(conn, mortgage_id, today)
