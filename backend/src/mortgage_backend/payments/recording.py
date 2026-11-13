"""Recording a Payment: refused if it isn't allowed, written, replayed, and kept in
History. A Payment that pays a Mortgage's whole Outstanding Redeems it (ADR 0011), by
the Closures in lending/closing.py. Voiding is in writes.py, beside what Reopening needs.
"""

from datetime import date, datetime

from fastapi import APIRouter, status
from sqlalchemy.engine import Connection

from mortgage_backend.lending.closing import close_redeemed
from mortgage_backend.lending.refusals import check_replays, refusal_names_mortgage
from mortgage_backend.lending.replay import MortgageReplay, replay
from mortgage_backend.payments.payments import Payment, load_payment
from mortgage_backend.payments.writes import (
    AllocationIn,
    PaymentIn,
    VoidIn,
    payment_grace,
    record_payment_history,
    refuse_payment,
    void_payment,
    write_payment,
)
from mortgage_backend.platform.clock import NowDep, TodayDep
from mortgage_backend.platform.db import EngineDep
from mortgage_backend.platform.errors import unprocessable


def record_payment(
    conn: Connection, payment: PaymentIn, today: date, now: datetime
) -> int:
    """Record a Payment (or refuse); returns its id. Each Mortgage it pays its whole
    Outstanding on the Payment date is Redeemed (ADR 0011), with its Final Payment kept
    as a part of its own: the id is then the Payment's first part. A Grace Payment
    keeps its received date and what it let off on each Mortgage, its Final Payments
    too."""
    rows = refuse_payment(conn, payment, today)
    grace = payment_grace(conn, payment, today)
    redeemed = []
    for allocation in payment.allocations:
        with refusal_names_mortgage(conn, allocation.mortgage_id):
            mortgage = _redeemed_by(conn, allocation, payment.paid_on, today)
        if mortgage is not None:
            redeemed.append((allocation, mortgage))
    redeemed_ids = {allocation.mortgage_id for allocation, _ in redeemed}
    ordinary = [a for a in payment.allocations if a.mortgage_id not in redeemed_ids]
    first = None
    if ordinary:
        paid = payment.model_copy(
            update={"amount": sum(a.amount for a in ordinary), "allocations": ordinary}
        )
        first = write_payment(conn, paid, grace=grace)
        check_replays(conn, [r for r in rows if r["id"] not in redeemed_ids], today)
        record_payment_history(conn, first, paid, now)
    for allocation, mortgage in redeemed:
        with refusal_names_mortgage(conn, allocation.mortgage_id):
            final = close_redeemed(
                conn,
                mortgage,
                payment.paid_on,
                allocation.amount,
                payment.method,
                payment.reference,
                today,
                now,
                received_with=first,
                discount=allocation.discount,
                grace=grace,
            )
        assert final is not None  # an Allocation is more than nothing
        if first is None:
            first = final
    assert first is not None  # there is at least one Allocation
    return first


def _redeemed_by(
    conn: Connection, allocation: AllocationIn, on: date, today: date
) -> MortgageReplay | None:
    """The Mortgage, if the Allocation is its whole Outstanding on `on`: paying all of
    it Redeems it, so it is refused if the Mortgage can't be Redeemed then."""
    mortgage = replay(conn, allocation.mortgage_id)
    full_payment = allocation.amount + allocation.discount
    if full_payment != mortgage.outstanding_on_closure(on).total:
        return None
    # (Not a future date: the Payment's own checks refuse that.)
    refusal = mortgage.not_closable(on)
    if refusal is not None:
        raise unprocessable(refusal)
    return mortgage


router = APIRouter(prefix="/api")


@router.post("/payments", status_code=status.HTTP_201_CREATED)
def post_payment(
    payment: PaymentIn, engine: EngineDep, today: TodayDep, now: NowDep
) -> Payment:
    with engine.begin() as conn:
        return load_payment(conn, record_payment(conn, payment, today, now))


@router.post("/payments/{payment_id}/void")
def post_void(
    payment_id: int, body: VoidIn, engine: EngineDep, today: TodayDep, now: NowDep
) -> Payment:
    """Void a Payment entered by mistake; a corrected one is entered as a new Payment."""
    with engine.begin() as conn:
        void_payment(conn, payment_id, body.reason, today, now)
        return load_payment(conn, payment_id)
