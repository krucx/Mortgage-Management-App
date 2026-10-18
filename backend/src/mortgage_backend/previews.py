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

from mortgage_backend.call_list import CALL_LIST_SETTINGS, loan_to_value_too_high
from mortgage_backend.clock import NowDep, TodayDep
from mortgage_backend.collateral import Collateral
from mortgage_backend.db import EngineDep
from mortgage_backend.ledger import LedgerEvent, LedgerStep
from mortgage_backend.changes import (
    CollateralIn,
    ForfeitIn,
    PaymentIn,
    RedeemIn,
    TermChangeIn,
    add_term_change,
    create_mortgage,
    edit_mortgage,
    forfeit,
    record_payment,
    redeem,
    remove_term_change,
    reopen,
    set_collateral,
    void_payment,
)
from mortgage_backend.mortgages import MortgageEdit, MortgageIn, load_mortgage
from mortgage_backend.payments import mortgages_of
from mortgage_backend.projections import ComingTermChange, ProjectedPoint, baseline
from mortgage_backend.replay import MortgageStatus, replay
from mortgage_backend.terms import Terms


class PreviewSide(BaseModel):
    outstanding: int  # today
    # The Projection with no further Payments (empty for a closed Mortgage)
    points: list[ProjectedPoint]
    term_changes: list[ComingTermChange]


class LedgerChange(BaseModel):
    """A Ledger step that differs: None on the side where it does not exist."""

    on: date
    event: LedgerEvent
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
        mortgage = replay(conn, mortgage_id)
        # Only an Active Mortgage has a Projection.
        active = mortgage.row["status"] == MortgageStatus.ACTIVE
        projection = baseline(conn, mortgage, today) if active else None
        found[mortgage_id] = _Snapshot(
            mortgage.row["name"],
            mortgage.ledger(today),
            PreviewSide(
                outstanding=mortgage.outstanding(today).total,
                points=projection.points if projection else [],
                term_changes=projection.term_changes if projection else [],
            ),
        )
    return found


def _preview(
    conn: Connection,
    mortgage_ids: Sequence[int],
    today: date,
    change: Callable[[], object],
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
            lambda: edit_mortgage(conn, mortgage_id, edit, today, now),
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
            lambda: add_term_change(conn, mortgage_id, change, today, now),
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
            lambda: void_payment(conn, payment_id, "preview", today, now),
        )


@router.post("/mortgages/{mortgage_id}/term-changes/{change_id}/remove-preview")
def preview_term_change_removal(
    mortgage_id: int, change_id: int, engine: EngineDep, today: TodayDep, now: NowDep
) -> list[MortgagePreview]:
    with engine.connect() as conn:
        return _preview(
            conn,
            [mortgage_id],
            today,
            lambda: remove_term_change(conn, mortgage_id, change_id, today, now),
        )


@router.post("/mortgages/{mortgage_id}/redeem-preview")
def preview_redeem(
    mortgage_id: int, body: RedeemIn, engine: EngineDep, today: TodayDep, now: NowDep
) -> list[MortgagePreview]:
    with engine.connect() as conn:
        return _preview(
            conn,
            [mortgage_id],
            today,
            lambda: redeem(conn, mortgage_id, body, today, now),
        )


@router.post("/mortgages/{mortgage_id}/forfeit-preview")
def preview_forfeit(
    mortgage_id: int, body: ForfeitIn, engine: EngineDep, today: TodayDep, now: NowDep
) -> list[MortgagePreview]:
    with engine.connect() as conn:
        return _preview(
            conn,
            [mortgage_id],
            today,
            lambda: forfeit(conn, mortgage_id, body, today, now),
        )


@router.post("/mortgages/{mortgage_id}/reopen-preview")
def preview_reopen(
    mortgage_id: int, engine: EngineDep, today: TodayDep, now: NowDep
) -> list[MortgagePreview]:
    """The Mortgage Active again; a Redemption's final Payment Voided."""
    with engine.connect() as conn:
        return _preview(
            conn,
            [mortgage_id],
            today,
            lambda: reopen(conn, mortgage_id, "preview", today, now),
        )


@router.post("/payments/preview")
def preview_payment(
    payment: PaymentIn, engine: EngineDep, today: TodayDep, now: NowDep
) -> list[MortgagePreview]:
    """Every Mortgage the Payment is allocated to, before and after recording it."""
    with engine.connect() as conn:
        return _preview(
            conn,
            [allocation.mortgage_id for allocation in payment.allocations],
            today,
            lambda: record_payment(conn, payment, today, now),
        )


class NewMortgagePreview(BaseModel):
    """What a new Mortgage would be: its Mortgage Name and Terms, what it would owe
    today (if back-dated), and its Projection with no Payments."""

    name: str
    terms: Terms
    after: PreviewSide


@router.post("/mortgages/preview")
def preview_new_mortgage(
    mortgage: MortgageIn, engine: EngineDep, today: TodayDep, now: NowDep
) -> NewMortgagePreview:
    with engine.connect() as conn:
        try:
            mortgage_id = create_mortgage(conn, mortgage, today, now)
            created = _snapshot(conn, [mortgage_id], today)[mortgage_id]
            row = replay(conn, mortgage_id).row
        finally:
            conn.rollback()
    return NewMortgagePreview(
        name=created.name,
        terms=Terms(
            monthly_rate_bps=row["monthly_rate_bps"],
            interest_mode=row["interest_mode"],
            part_month_rule=row["part_month_rule"],
        ),
        after=created.side,
    )


class CollateralPreview(BaseModel):
    """The Collateral Value (and so Loan-to-Value) before and after setting it, and
    whether that puts the Mortgage on the Call List for its Loan-to-Value."""

    before: Collateral | None
    after: Collateral | None
    listed_before: bool
    listed_after: bool


@router.post("/mortgages/{mortgage_id}/collateral-preview")
def preview_collateral(
    mortgage_id: int,
    collateral: CollateralIn,
    engine: EngineDep,
    today: TodayDep,
    now: NowDep,
) -> CollateralPreview:
    with engine.connect() as conn:
        try:
            before = load_mortgage(conn, mortgage_id, today).collateral
            set_collateral(conn, mortgage_id, collateral.value, today, now)
            after = load_mortgage(conn, mortgage_id, today).collateral
            settings = CALL_LIST_SETTINGS.get(conn)
        finally:
            conn.rollback()

    def listed(value: Collateral | None) -> bool:
        ratio = value.loan_to_value if value else None
        return loan_to_value_too_high(ratio, settings)

    return CollateralPreview(
        before=before,
        after=after,
        listed_before=listed(before),
        listed_after=listed(after),
    )
