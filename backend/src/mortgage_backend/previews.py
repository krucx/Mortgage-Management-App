"""Before/after previews of a change, computed without saving anything.

Each preview makes the real change (with the same checks as saving it) inside a
transaction, reads the Ledger and Projection, then rolls the transaction back.
"""

from collections.abc import Callable, Sequence
from datetime import date
from typing import NamedTuple, get_args

from fastapi import APIRouter
from pydantic import BaseModel
from sqlalchemy.engine import Connection

from mortgage_backend.clock import NowDep, TodayDep
from mortgage_backend.db import EngineDep
from mortgage_backend.ledger import LedgerEvent, LedgerStep
from mortgage_backend.mortgages import (
    MortgageEdit,
    MortgageStatus,
    apply_edit,
    ledgers_of,
    mortgage_row,
    outstanding_of,
)
from mortgage_backend.payments import apply_void, mortgages_of
from mortgage_backend.projections import ProjectedEvent, ProjectedPoint, baseline
from mortgage_backend.term_changes import TermChangeIn, apply_term_change


class PreviewSide(BaseModel):
    outstanding: int  # today
    # The Projection with no further Payments (empty for a closed Mortgage)
    points: list[ProjectedPoint]
    events: list[ProjectedEvent]


class LedgerChange(BaseModel):
    """A Ledger step that differs: None on the side where it does not exist."""

    on: date
    event: str
    before: LedgerStep | None
    after: LedgerStep | None


class MortgagePreview(BaseModel):
    mortgage_id: int
    mortgage_name: str
    before: PreviewSide
    after: PreviewSide
    ledger_changes: list[LedgerChange]


# The order steps happen in on one day, as the ledger engine lists them.
_EVENT_ORDER: tuple[str, ...] = get_args(LedgerEvent)


def _step_identity(step: LedgerStep) -> tuple[date, int, int]:
    """Matches a step across two Ledgers: its date, kind and Payment."""
    return (step.on, _EVENT_ORDER.index(step.event), step.payment_id or 0)


def _ledger_changes(
    before: Sequence[LedgerStep], after: Sequence[LedgerStep]
) -> list[LedgerChange]:
    """The steps added, removed or changed, in date order."""
    old = {_step_identity(step): step for step in before}
    new = {_step_identity(step): step for step in after}
    return [
        LedgerChange(
            on=key[0],
            event=_EVENT_ORDER[key[1]],
            before=old.get(key),
            after=new.get(key),
        )
        for key in sorted(old.keys() | new.keys())
        if old.get(key) != new.get(key)
    ]


class _Snapshot(NamedTuple):
    name: str
    ledger: list[LedgerStep]
    side: PreviewSide


def _snapshot(
    conn: Connection, mortgage_ids: Sequence[int], today: date
) -> dict[int, _Snapshot]:
    """Each Mortgage's Ledger and Projection as the database stands."""
    found = {}
    for mortgage_id in mortgage_ids:
        row = mortgage_row(conn, mortgage_id)
        ledger = ledgers_of(conn, [row], today)[mortgage_id]
        # Only an Active Mortgage has a Projection.
        active = row["status"] == MortgageStatus.ACTIVE
        projection = baseline(conn, row, today) if active else None
        found[mortgage_id] = _Snapshot(
            row["name"],
            ledger,
            PreviewSide(
                outstanding=outstanding_of(ledger).total,
                points=projection.points if projection else [],
                events=projection.events if projection else [],
            ),
        )
    return found


def _preview(
    conn: Connection,
    mortgage_ids: Sequence[int],
    today: date,
    change: Callable[[], None],
) -> list[MortgagePreview]:
    """Each Mortgage before and after `change`, which is then undone."""
    try:
        before = _snapshot(conn, mortgage_ids, today)
        change()
        after = _snapshot(conn, mortgage_ids, today)
    finally:
        conn.rollback()
    return [
        MortgagePreview(
            mortgage_id=mortgage_id,
            mortgage_name=after[mortgage_id].name,
            before=before[mortgage_id].side,
            after=after[mortgage_id].side,
            ledger_changes=_ledger_changes(
                before[mortgage_id].ledger, after[mortgage_id].ledger
            ),
        )
        for mortgage_id in mortgage_ids
    ]


router = APIRouter(prefix="/api")


@router.post("/mortgages/{mortgage_id}/edit-preview")
def preview_edit(
    mortgage_id: int,
    edit: MortgageEdit,
    engine: EngineDep,
    today: TodayDep,
    now: NowDep,
) -> list[MortgagePreview]:
    with engine.connect() as conn:
        return _preview(
            conn,
            [mortgage_id],
            today,
            lambda: apply_edit(conn, mortgage_id, edit, today, now),
        )


@router.post("/mortgages/{mortgage_id}/term-changes/preview")
def preview_term_change(
    mortgage_id: int,
    change: TermChangeIn,
    engine: EngineDep,
    today: TodayDep,
    now: NowDep,
) -> list[MortgagePreview]:
    with engine.connect() as conn:
        return _preview(
            conn,
            [mortgage_id],
            today,
            lambda: apply_term_change(conn, mortgage_id, change, today, now),
        )


@router.post("/payments/{payment_id}/void-preview")
def preview_void(
    payment_id: int, engine: EngineDep, today: TodayDep, now: NowDep
) -> list[MortgagePreview]:
    """Every Mortgage the Payment was allocated to, before and after Voiding it."""
    with engine.connect() as conn:
        mortgage_ids = [m["id"] for m in mortgages_of(conn, payment_id)]
        return _preview(
            conn,
            mortgage_ids,
            today,
            lambda: apply_void(conn, payment_id, "preview", now),
        )
