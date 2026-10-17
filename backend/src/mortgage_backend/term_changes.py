"""Term Changes: new Terms for a running Mortgage from an Accrual Date on.

Each month is charged under the Terms in force at its start, so a Term Change never
alters interest already charged. It can be removed until it takes effect.
"""

from datetime import date, datetime

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import delete, insert, select
from sqlalchemy.engine import Connection

from mortgage_backend import audit
from mortgage_backend.clock import NowDep, TodayDep
from mortgage_backend.db import EngineDep, term_change_table
from mortgage_backend.errors import unprocessable
from mortgage_backend.ledger import is_accrual_date
from mortgage_backend.mortgages import Mortgage, load_mortgage, upcoming_accrual_dates
from mortgage_backend.replay import MortgageStatus, mortgage_row, replay
from mortgage_backend.terms import InterestMode, PartMonthRule, Terms


class TermChangeIn(BaseModel):
    """What changes; anything left out carries over from the Terms in force then."""

    effective_on: date | None = None  # an Accrual Date; None: the next one
    monthly_rate_bps: int | None = Field(default=None, gt=0, le=10_000)
    interest_mode: InterestMode | None = None
    part_month_rule: PartMonthRule | None = None


router = APIRouter(prefix="/api")


def apply_term_change(
    conn: Connection, mortgage_id: int, change: TermChangeIn, today: date, now: datetime
) -> None:
    """Add a Term Change (or refuse)."""
    mortgage = replay(conn, mortgage_id)
    row = mortgage.row
    if row["status"] != MortgageStatus.ACTIVE:
        raise HTTPException(
            status.HTTP_409_CONFLICT, f"{row['name']} is {row['status']}"
        )
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


@router.post(
    "/mortgages/{mortgage_id}/term-changes", status_code=status.HTTP_201_CREATED
)
def add_term_change(
    mortgage_id: int,
    change: TermChangeIn,
    engine: EngineDep,
    today: TodayDep,
    now: NowDep,
) -> Mortgage:
    with engine.begin() as conn:
        apply_term_change(conn, mortgage_id, change, today, now)
        return load_mortgage(conn, mortgage_id, today)


@router.delete("/mortgages/{mortgage_id}/term-changes/{change_id}")
def remove_term_change(
    mortgage_id: int,
    change_id: int,
    engine: EngineDep,
    today: TodayDep,
    now: NowDep,
) -> Mortgage:
    """Remove a Term Change that has not taken effect yet."""
    with engine.begin() as conn:
        row = mortgage_row(conn, mortgage_id)
        if row["status"] != MortgageStatus.ACTIVE:
            raise HTTPException(
                status.HTTP_409_CONFLICT, f"{row['name']} is {row['status']}"
            )
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
        conn.execute(
            delete(term_change_table).where(term_change_table.c.id == change_id)
        )
        audit.record(
            conn,
            now,
            "mortgage",
            mortgage_id,
            "term_change_removed",
            note=f"from {effective_on:%d %b %Y}",
        )
        return load_mortgage(conn, mortgage_id, today)
