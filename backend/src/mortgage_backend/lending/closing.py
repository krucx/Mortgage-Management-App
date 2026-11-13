"""Closures: Redeeming, Waiving, Forfeiting (one Mortgage or several at once) and
Reopening, and what closing a Mortgage would take on a date, its Outstanding then, and
which Mortgages are Dormant, owing nothing with their jewellery still held.

Each is refused if it isn't allowed, written, replayed, and kept in History. A final
Payment is written through payments/writes.py; paying a Mortgage's whole Outstanding in
payments/recording.py Redeems it here.
"""

from collections.abc import Callable
from datetime import date, datetime
from typing import Any, Literal

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import update
from sqlalchemy.engine import Connection

from mortgage_backend.lending.mortgages import (
    Mortgage,
    MortgageRow,
    load_mortgage,
    mortgage_rows,
    select_with_customer,
)
from mortgage_backend.lending.refusals import check_replays, refusal_names_mortgage
from mortgage_backend.lending.replay import (
    MortgageReplay,
    MortgageStatus,
    OutstandingOnClosure,
    mortgage_row,
    replay,
    replays,
)
from mortgage_backend.payments.payments import PaymentMethod
from mortgage_backend.payments.writes import (
    AllocationIn,
    Grace,
    PaymentIn,
    VoidIn,
    record_payment_history,
    refuse_payment,
    void_payment,
    write_payment,
)
from mortgage_backend.platform.clock import NowDep, TodayDep
from mortgage_backend.platform.db import EngineDep, mortgage_table
from mortgage_backend.platform.errors import unprocessable
from mortgage_backend.platform.money import format_inr
from mortgage_backend.platform.paging import Page, PageNumber, rows_page
from mortgage_backend.safekeeping import audit


class RedeemIn(BaseModel):
    redeemed_on: date
    method: PaymentMethod  # how the final Payment was made
    reference: str | None = None


class WaiveIn(BaseModel):
    waived_on: date
    amount_paid: int = Field(ge=0)  # paise: the final Payment; the rest is waived
    method: PaymentMethod  # how the final Payment was made, if any
    reference: str | None = None
    note: str = ""  # why it was waived


class ForfeitIn(BaseModel):
    forfeited_on: date
    recovered_amount: int = Field(ge=0)  # paise: sale price, or value if kept
    note: str = ""


class RedeemAllIn(BaseModel):
    """Several Mortgages Redeemed on one date, any final Payments made the same way."""

    redeemed_on: date
    method: PaymentMethod  # how the final Payments were made
    reference: str | None = None
    mortgage_ids: list[int] = Field(min_length=1)


class WaivedMortgageIn(BaseModel):
    mortgage_id: int
    amount_paid: int = Field(ge=0)  # paise: its final Payment; the rest is waived


class WaiveAllIn(BaseModel):
    """Several Mortgages Waived off on one date, each with its own final Payment."""

    waived_on: date
    method: PaymentMethod  # how the final Payments were made, if any
    reference: str | None = None
    note: str = ""  # why, for all of them
    mortgages: list[WaivedMortgageIn] = Field(min_length=1)


class ForfeitedMortgageIn(BaseModel):
    mortgage_id: int
    recovered_amount: int = Field(ge=0)  # paise: sale price, or value if kept


class ForfeitAllIn(BaseModel):
    """Several Mortgages Forfeited on one date, each with its own Recovered Amount."""

    forfeited_on: date
    note: str = ""  # for all of them
    mortgages: list[ForfeitedMortgageIn] = Field(min_length=1)


def closable(
    conn: Connection, mortgage_id: int, on: date, today: date, quote_only: bool = False
) -> MortgageReplay:
    """The Mortgage, if it can be closed on `on` (or, for a quote, could be then)."""
    mortgage = replay(conn, mortgage_id)
    # A closed Mortgage is refused for being closed, whatever the date.
    if (
        mortgage.row["status"] == MortgageStatus.ACTIVE
        and on > today
        and not quote_only
    ):
        raise unprocessable(
            "A Redemption, Waiver or Forfeiture cannot be recorded for a future date"
        )
    refusal = mortgage.not_closable(on)
    if refusal is not None:
        raise unprocessable(refusal)
    return mortgage


def _set_closure(conn: Connection, mortgage_id: int, **values: object) -> None:
    conn.execute(
        update(mortgage_table)
        .where(mortgage_table.c.id == mortgage_id)
        .values(**values)
    )


def _close_with_payment(
    conn: Connection,
    mortgage: MortgageReplay,
    closed_on: date,
    amount: int,
    method: PaymentMethod,
    reference: str | None,
    today: date,
    now: datetime,
    received_with: int | None = None,
    discount: int = 0,
    grace: Grace | None = None,
    **closure: object,
) -> int | None:
    """Record the final Payment of `amount` (unless it is nothing), received with the
    Payment `received_with` if any, and close the Mortgage as `closure` says; returns
    the final Payment's id. A Grace Payment's final Payment keeps its `grace`."""
    row = mortgage.row
    # The final Payment may include the Interest to Date, owed only once the Mortgage
    # closes, so it is replayed after closing rather than as an ordinary Payment.
    final = None
    payment_id = None
    if amount + discount > 0:
        final = PaymentIn(
            customer_id=row["customer_id"],
            paid_on=closed_on,
            received_on=grace.received_on if grace else None,
            amount=amount,
            method=method,
            reference=reference,
            allocations=[
                AllocationIn(mortgage_id=row["id"], amount=amount, discount=discount)
            ],
        )
        refuse_payment(conn, final, today)
        payment_id = write_payment(conn, final, received_with, grace)
    _set_closure(
        conn,
        row["id"],
        closed_on=closed_on,
        redemption_payment_id=payment_id,
        **closure,
    )
    check_replays(conn, [mortgage_row(conn, row["id"])], today)
    if final is not None and payment_id is not None:
        record_payment_history(conn, payment_id, final, now)
    return payment_id


def redeem(
    conn: Connection,
    mortgage_id: int,
    redeem: RedeemIn,
    today: date,
    now: datetime,
) -> None:
    """Record the final Payment of the Outstanding (unless nothing is owed) and mark
    the Mortgage Redeemed (or refuse)."""
    mortgage = closable(conn, mortgage_id, redeem.redeemed_on, today)
    owed = mortgage.outstanding_on_closure(redeem.redeemed_on).total
    close_redeemed(
        conn,
        mortgage,
        redeem.redeemed_on,
        owed,
        redeem.method,
        redeem.reference,
        today,
        now,
    )


def close_redeemed(
    conn: Connection,
    mortgage: MortgageReplay,
    on: date,
    owed: int,
    method: PaymentMethod,
    reference: str | None,
    today: date,
    now: datetime,
    received_with: int | None = None,
    discount: int = 0,
    grace: Grace | None = None,
) -> int | None:
    """Record the final Payment of the Outstanding `owed` (unless it is nothing)
    and mark the Mortgage Redeemed; returns the final Payment's id."""
    payment_id = _close_with_payment(
        conn,
        mortgage,
        on,
        owed,
        method,
        reference,
        today,
        now,
        received_with,
        discount=discount,
        grace=grace,
        status=MortgageStatus.REDEEMED,
    )
    audit.record(
        conn,
        now,
        "mortgage",
        mortgage.row["id"],
        "redeemed",
        note=f"on {on:%d %b %Y} for {format_inr(owed)}",
    )
    return payment_id


def waive(
    conn: Connection, mortgage_id: int, waive: WaiveIn, today: date, now: datetime
) -> None:
    """Record a final Payment of less than the Outstanding (or none), waive the
    rest, and mark the Mortgage Waived: the jewellery goes back (or refuse)."""
    mortgage = closable(conn, mortgage_id, waive.waived_on, today)
    owed = mortgage.outstanding_on_closure(waive.waived_on).total
    if owed == 0:
        raise unprocessable(
            f"{mortgage.row['name']} owes nothing then: Redeem it instead"
        )
    if waive.amount_paid >= owed:
        raise unprocessable(
            f"{format_inr(waive.amount_paid)} covers the {format_inr(owed)} owed: "
            "Redeem it instead"
        )
    _close_with_payment(
        conn,
        mortgage,
        waive.waived_on,
        waive.amount_paid,
        waive.method,
        waive.reference,
        today,
        now,
        status=MortgageStatus.WAIVED,
        closure_note=waive.note.strip() or None,
    )
    audit.record(
        conn,
        now,
        "mortgage",
        mortgage_id,
        "waived",
        note=(
            f"on {waive.waived_on:%d %b %Y}: paid {format_inr(waive.amount_paid)}, "
            f"waived {format_inr(owed - waive.amount_paid)}"
        ),
    )


def forfeit(
    conn: Connection, mortgage_id: int, forfeit: ForfeitIn, today: date, now: datetime
) -> None:
    """Mark the Mortgage Forfeited, recording what the jewellery recovered (or refuse)."""
    closable(conn, mortgage_id, forfeit.forfeited_on, today)
    _set_closure(
        conn,
        mortgage_id,
        status=MortgageStatus.FORFEITED,
        closed_on=forfeit.forfeited_on,
        recovered_amount=forfeit.recovered_amount,
        closure_note=forfeit.note.strip() or None,
    )
    check_replays(conn, [mortgage_row(conn, mortgage_id)], today)
    audit.record(
        conn,
        now,
        "mortgage",
        mortgage_id,
        "forfeited",
        note=(
            f"on {forfeit.forfeited_on:%d %b %Y}, recovered "
            f"{format_inr(forfeit.recovered_amount)}"
        ),
    )


def redeem_all(
    conn: Connection, redemptions: RedeemAllIn, today: date, now: datetime
) -> None:
    """Redeem each of the Mortgages (or refuse); in the caller's transaction, so a
    refusal of any one leaves all of them as they were."""
    each = RedeemIn(
        redeemed_on=redemptions.redeemed_on,
        method=redemptions.method,
        reference=redemptions.reference,
    )
    for mortgage_id in redemptions.mortgage_ids:
        with refusal_names_mortgage(conn, mortgage_id):
            redeem(conn, mortgage_id, each, today, now)


def waive_all(
    conn: Connection, waivers: WaiveAllIn, today: date, now: datetime
) -> None:
    """Waive off each of the Mortgages (or refuse); in the caller's transaction, so a
    refusal of any one leaves all of them as they were."""
    for waived in waivers.mortgages:
        with refusal_names_mortgage(conn, waived.mortgage_id):
            waive(
                conn,
                waived.mortgage_id,
                WaiveIn(
                    waived_on=waivers.waived_on,
                    amount_paid=waived.amount_paid,
                    method=waivers.method,
                    reference=waivers.reference,
                    note=waivers.note,
                ),
                today,
                now,
            )


def forfeit_all(
    conn: Connection, forfeits: ForfeitAllIn, today: date, now: datetime
) -> None:
    """Forfeit each of the Mortgages (or refuse); in the caller's transaction, so a
    refusal of any one leaves all of them as they were."""
    for forfeited in forfeits.mortgages:
        with refusal_names_mortgage(conn, forfeited.mortgage_id):
            forfeit(
                conn,
                forfeited.mortgage_id,
                ForfeitIn(
                    forfeited_on=forfeits.forfeited_on,
                    recovered_amount=forfeited.recovered_amount,
                    note=forfeits.note,
                ),
                today,
                now,
            )


def reopen(
    conn: Connection, mortgage_id: int, reason: str, today: date, now: datetime
) -> None:
    """Undo a Closure (or refuse); a Redemption's or Waiver's final Payment is Voided
    once the Mortgage is Active again."""
    row = mortgage_row(conn, mortgage_id)
    if row["status"] == MortgageStatus.ACTIVE:
        raise HTTPException(status.HTTP_409_CONFLICT, f"{row['name']} is Active")
    _set_closure(
        conn,
        mortgage_id,
        status=MortgageStatus.ACTIVE,
        closed_on=None,
        redemption_payment_id=None,
        recovered_amount=None,
        closure_note=None,
    )
    if row["redemption_payment_id"] is not None:
        void_payment(conn, row["redemption_payment_id"], reason, today, now)
    check_replays(conn, [mortgage_row(conn, mortgage_id)], today)
    audit.record(
        conn,
        now,
        "mortgage",
        mortgage_id,
        "reopened",
        [audit.Change("status", row["status"], MortgageStatus.ACTIVE)],
        note=reason,
    )


router = APIRouter(prefix="/api")


@router.get("/mortgages/{mortgage_id}/outstanding-on-closure")
def outstanding_on_closure(
    mortgage_id: int, on: date, engine: EngineDep, today: TodayDep
) -> OutstandingOnClosure:
    """What it takes to close the Mortgage on `on`: its Outstanding then."""
    with engine.connect() as conn:
        mortgage = closable(conn, mortgage_id, on, today, quote_only=True)
        return mortgage.outstanding_on_closure(on)


# A column of the Dormant list to sort it by.
DormantSort = Literal["mortgage", "customer"]

_SORT_KEYS: dict[DormantSort, Callable[[MortgageRow], Any]] = {
    "mortgage": lambda row: row.name.casefold(),
    "customer": lambda row: row.customer.name.casefold(),
}


@router.get("/closures/dormant")
def dormant(
    engine: EngineDep,
    today: TodayDep,
    page: PageNumber = 1,
    sort: DormantSort | None = None,
    descending: bool = False,
) -> Page[MortgageRow]:
    """Dormant Mortgages, Active yet owing nothing today, oldest first (or by `sort`,
    reversed when `descending`)."""
    with engine.connect() as conn:
        rows = (
            conn.execute(
                select_with_customer()
                .where(mortgage_table.c.status == MortgageStatus.ACTIVE)
                .order_by(mortgage_table.c.start_date, mortgage_table.c.id)
            )
            .mappings()
            .all()
        )
        replayed = replays(conn, rows)
        listed = mortgage_rows(
            conn, [r for r in rows if replayed[r["id"]].dormant(today)], today, replayed
        )
    return rows_page(listed, page, _SORT_KEYS, sort=sort, descending=descending)


@router.post("/mortgages/{mortgage_id}/redeem")
def post_redeem(
    mortgage_id: int, body: RedeemIn, engine: EngineDep, today: TodayDep, now: NowDep
) -> Mortgage:
    """Record the final Payment of the Outstanding and mark the Mortgage Redeemed."""
    with engine.begin() as conn:
        redeem(conn, mortgage_id, body, today, now)
        return load_mortgage(conn, mortgage_id, today)


@router.post("/mortgages/{mortgage_id}/waive")
def post_waive(
    mortgage_id: int, body: WaiveIn, engine: EngineDep, today: TodayDep, now: NowDep
) -> Mortgage:
    """Record a final Payment short of the Outstanding, waive the rest, and mark
    the Mortgage Waived."""
    with engine.begin() as conn:
        waive(conn, mortgage_id, body, today, now)
        return load_mortgage(conn, mortgage_id, today)


@router.post("/mortgages/{mortgage_id}/forfeit")
def post_forfeit(
    mortgage_id: int, body: ForfeitIn, engine: EngineDep, today: TodayDep, now: NowDep
) -> Mortgage:
    """Mark the Mortgage Forfeited, recording what the jewellery recovered."""
    with engine.begin() as conn:
        forfeit(conn, mortgage_id, body, today, now)
        return load_mortgage(conn, mortgage_id, today)


@router.post("/closures/redeem")
def post_redeem_all(
    body: RedeemAllIn, engine: EngineDep, today: TodayDep, now: NowDep
) -> list[Mortgage]:
    """Redeem several Mortgages at once: all of them, or (if any is refused) none."""
    with engine.begin() as conn:
        redeem_all(conn, body, today, now)
        return [load_mortgage(conn, m, today) for m in body.mortgage_ids]


@router.post("/closures/waive")
def post_waive_all(
    body: WaiveAllIn, engine: EngineDep, today: TodayDep, now: NowDep
) -> list[Mortgage]:
    """Waive off several Mortgages at once: all of them, or (if any is refused) none."""
    with engine.begin() as conn:
        waive_all(conn, body, today, now)
        return [load_mortgage(conn, m.mortgage_id, today) for m in body.mortgages]


@router.post("/closures/forfeit")
def post_forfeit_all(
    body: ForfeitAllIn, engine: EngineDep, today: TodayDep, now: NowDep
) -> list[Mortgage]:
    """Forfeit several Mortgages at once: all of them, or (if any is refused) none."""
    with engine.begin() as conn:
        forfeit_all(conn, body, today, now)
        return [load_mortgage(conn, m.mortgage_id, today) for m in body.mortgages]


@router.post("/mortgages/{mortgage_id}/reopen")
def post_reopen(
    mortgage_id: int, body: VoidIn, engine: EngineDep, today: TodayDep, now: NowDep
) -> Mortgage:
    """Undo a Closure; a Redemption's or Waiver's final Payment is Voided."""
    with engine.begin() as conn:
        reopen(conn, mortgage_id, body.reason, today, now)
        return load_mortgage(conn, mortgage_id, today)
