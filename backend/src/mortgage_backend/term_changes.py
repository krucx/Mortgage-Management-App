"""Term Changes: new Terms for a running Mortgage from an Accrual Date on.

Each month is charged under the Terms in force at its start, so a Term Change never
alters interest already charged. It can be removed until it takes effect.
"""

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import delete, select

from mortgage_backend import audit
from mortgage_backend.clock import NowDep, TodayDep
from mortgage_backend.db import EngineDep, term_change_table
from mortgage_backend.mortgages import Mortgage, load_mortgage
from mortgage_backend.replay import MortgageStatus, mortgage_row


router = APIRouter(prefix="/api")


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
