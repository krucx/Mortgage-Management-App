"""Closing a Mortgage: Redemption (paid in full, jewellery returned) or Forfeiture."""

from datetime import date

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select, update
from sqlalchemy.engine import Connection, RowMapping

from mortgage_backend.clock import TodayDep
from mortgage_backend.db import (
    EngineDep,
    allocation_table,
    mortgage_table,
    payment_table,
)
from mortgage_backend.errors import unprocessable
from mortgage_backend.mortgages import (
    Mortgage,
    MortgageStatus,
    Redemption,
    load_mortgage,
    redemption_on,
)
from mortgage_backend.payments import (
    AllocationIn,
    PaymentIn,
    PaymentMethod,
    check_no_overpayment,
    insert_payment,
)


class RedeemIn(BaseModel):
    redeemed_on: date
    method: PaymentMethod  # how the final Payment was made
    reference: str | None = None


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
            allocation_table.c.mortgage_id == mortgage_id, payment_table.c.paid_on > on
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
    mortgage_id: int, redeem: RedeemIn, engine: EngineDep, today: TodayDep
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
        return load_mortgage(conn, mortgage_id, today)


@router.post("/mortgages/{mortgage_id}/forfeit")
def forfeit(
    mortgage_id: int, forfeit: ForfeitIn, engine: EngineDep, today: TodayDep
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
        return load_mortgage(conn, mortgage_id, today)
