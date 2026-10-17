"""Closing a Mortgage: Redemption (paid in full, jewellery returned) or Forfeiture."""

from datetime import date

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select, update
from sqlalchemy.engine import Connection, RowMapping

from mortgage_backend import audit
from mortgage_backend.clock import NowDep, TodayDep
from mortgage_backend.db import (
    EngineDep,
    allocation_table,
    mortgage_table,
    payment_table,
)
from mortgage_backend.errors import unprocessable
from mortgage_backend.money import format_inr
from mortgage_backend.mortgages import (
    Mortgage,
    MortgageRow,
    MortgageStatus,
    Redemption,
    load_mortgage,
    mortgage_row,
    mortgage_rows,
    redemption_on,
    select_with_customer,
)
from mortgage_backend.payments import (
    AllocationIn,
    PaymentIn,
    PaymentMethod,
    VoidIn,
    check_no_overpayment,
    insert_payment,
    void_payment,
)


class RedeemIn(BaseModel):
    redeemed_on: date
    method: PaymentMethod  # how the final Payment was made
    reference: str | None = None


class ReadyToRedeem(BaseModel):
    """An Active Mortgage with nothing Outstanding: the jewellery is waiting to go back."""

    mortgage: MortgageRow
    redemption: Redemption  # redeeming today; may include a Part-Month Rule charge


class ForfeitIn(BaseModel):
    forfeited_on: date
    recovered_amount: int = Field(ge=0)  # paise: sale price, or value if kept
    note: str = ""


def _closable(
    conn: Connection, mortgage_id: int, on: date, today: date, quote_only: bool = False
) -> RowMapping:
    """The Mortgage row, if it can be closed on `on` (or, for a quote, could be then)."""
    row = (
        conn.execute(select(mortgage_table).where(mortgage_table.c.id == mortgage_id))
        .mappings()
        .first()
    )
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Mortgage not found")
    if row["status"] != MortgageStatus.ACTIVE:
        raise unprocessable(f"{row['name']} is already {row['status']}")
    if on > today and not quote_only:
        raise unprocessable(
            "A Redemption or Forfeiture cannot be recorded for a future date"
        )
    if on < row["start_date"]:
        raise unprocessable(f"{row['name']} had not started on that date")
    later = conn.execute(
        select(payment_table.c.paid_on)
        .join(allocation_table, allocation_table.c.payment_id == payment_table.c.id)
        .where(
            allocation_table.c.mortgage_id == mortgage_id,
            payment_table.c.paid_on > on,
            payment_table.c.voided_at.is_(None),
        )
        .order_by(payment_table.c.paid_on.desc())
    ).first()
    if later is not None:
        raise unprocessable(
            f"There are Payments after that date (latest {later.paid_on:%d %b %Y}); "
            "close it on or after then"
        )
    return row


def _close(conn: Connection, mortgage_id: int, **values: object) -> None:
    conn.execute(
        update(mortgage_table)
        .where(mortgage_table.c.id == mortgage_id)
        .values(**values)
    )


router = APIRouter(prefix="/api")


@router.get("/mortgages/{mortgage_id}/redemption")
def redemption_amount(
    mortgage_id: int, on: date, engine: EngineDep, today: TodayDep
) -> Redemption:
    """What it takes to redeem the Mortgage on `on`."""
    with engine.connect() as conn:
        row = _closable(conn, mortgage_id, on, today, quote_only=True)
        return redemption_on(conn, row, on)


@router.post("/mortgages/{mortgage_id}/redeem")
def redeem(
    mortgage_id: int, redeem: RedeemIn, engine: EngineDep, today: TodayDep, now: NowDep
) -> Mortgage:
    """Record the final Payment of the Redemption Amount and mark the Mortgage Redeemed."""
    with engine.begin() as conn:
        row = _closable(conn, mortgage_id, redeem.redeemed_on, today)
        owed = redemption_on(conn, row, redeem.redeemed_on).total
        payment_id = None
        if owed > 0:
            payment_id = insert_payment(
                conn,
                PaymentIn(
                    customer_id=row["customer_id"],
                    paid_on=redeem.redeemed_on,
                    amount=owed,
                    method=redeem.method,
                    reference=redeem.reference,
                    allocations=[AllocationIn(mortgage_id=mortgage_id, amount=owed)],
                ),
                now,
            )
        _close(
            conn,
            mortgage_id,
            status=MortgageStatus.REDEEMED,
            closed_on=redeem.redeemed_on,
            redemption_payment_id=payment_id,
        )
        if payment_id is not None:
            check_no_overpayment(conn, payment_id, today)
        audit.record(
            conn,
            now,
            "mortgage",
            mortgage_id,
            "redeemed",
            note=f"on {redeem.redeemed_on:%d %b %Y} for {format_inr(owed)}",
        )
        return load_mortgage(conn, mortgage_id, today)


@router.post("/mortgages/{mortgage_id}/forfeit")
def forfeit(
    mortgage_id: int,
    forfeit: ForfeitIn,
    engine: EngineDep,
    today: TodayDep,
    now: NowDep,
) -> Mortgage:
    """Mark the Mortgage Forfeited, recording what the jewellery recovered."""
    with engine.begin() as conn:
        _closable(conn, mortgage_id, forfeit.forfeited_on, today)
        _close(
            conn,
            mortgage_id,
            status=MortgageStatus.FORFEITED,
            closed_on=forfeit.forfeited_on,
            recovered_amount=forfeit.recovered_amount,
            closure_note=forfeit.note.strip() or None,
        )
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
        return load_mortgage(conn, mortgage_id, today)


@router.post("/mortgages/{mortgage_id}/reopen")
def reopen(
    mortgage_id: int, body: VoidIn, engine: EngineDep, today: TodayDep, now: NowDep
) -> Mortgage:
    """Undo a Redemption or Forfeiture; a Redemption's final Payment is Voided."""
    with engine.begin() as conn:
        row = mortgage_row(conn, mortgage_id)
        if row["status"] == MortgageStatus.ACTIVE:
            raise HTTPException(status.HTTP_409_CONFLICT, f"{row['name']} is Active")
        if row["redemption_payment_id"] is not None:
            void_payment(conn, row["redemption_payment_id"], body.reason, now)
        _close(
            conn,
            mortgage_id,
            status=MortgageStatus.ACTIVE,
            closed_on=None,
            redemption_payment_id=None,
            recovered_amount=None,
            closure_note=None,
        )
        audit.record(
            conn,
            now,
            "mortgage",
            mortgage_id,
            "reopened",
            [audit.Change("status", row["status"], MortgageStatus.ACTIVE)],
            note=body.reason,
        )
        return load_mortgage(conn, mortgage_id, today)


@router.get("/closures/ready-to-redeem")
def ready_to_redeem(engine: EngineDep, today: TodayDep) -> list[ReadyToRedeem]:
    """Active Mortgages paid down to nothing Outstanding, oldest first."""
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
        listed = mortgage_rows(conn, rows, today)
        return [
            ReadyToRedeem(mortgage=mortgage, redemption=redemption_on(conn, row, today))
            for row, mortgage in zip(rows, listed, strict=True)
            if mortgage.outstanding_total == 0
        ]
