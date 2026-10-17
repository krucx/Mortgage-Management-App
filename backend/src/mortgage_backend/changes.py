"""Changes to Mortgages and Payments, each made in one place: recording and Voiding
Payments, edits, adding and removing Term Changes, and Redeeming, Forfeiting and
Reopening.

Every change is refused if it isn't allowed, written, then checked by replaying each
Mortgage it touches (no Payment may end up larger than what was owed on its date), and
then recorded in History. The request handlers only parse, call and answer; Previews make the
same change and roll it back.
"""

from collections.abc import Sequence
from datetime import date, datetime

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import delete, func, insert, select, update
from sqlalchemy.engine import Connection, RowMapping

from mortgage_backend import audit
from mortgage_backend.clock import NowDep, TodayDep
from mortgage_backend.db import (
    EngineDep,
    allocation_table,
    customer_table,
    exists,
    mortgage_table,
    payment_table,
    term_change_table,
)
from mortgage_backend.errors import unprocessable
from mortgage_backend.ledger import Overpayment, is_accrual_date
from mortgage_backend.money import format_inr
from mortgage_backend.mortgages import (
    Mortgage,
    MortgageEdit,
    load_mortgage,
    upcoming_accrual_dates,
)
from mortgage_backend.payments import Payment, PaymentMethod, load_payment, mortgages_of
from mortgage_backend.replay import (
    MortgageReplay,
    MortgageStatus,
    mortgage_row,
    replay,
    replays,
)
from mortgage_backend.terms import InterestMode, PartMonthRule, Terms


class AllocationIn(BaseModel):
    mortgage_id: int
    amount: int = Field(gt=0)  # paise


class PaymentIn(BaseModel):
    customer_id: int
    paid_on: date
    amount: int = Field(gt=0)  # paise
    method: PaymentMethod
    reference: str | None = None
    allocations: list[AllocationIn] = Field(min_length=1)

    @model_validator(mode="after")
    def allocations_add_up(self) -> "PaymentIn":
        if sum(allocation.amount for allocation in self.allocations) != self.amount:
            raise ValueError("Allocations must add up to the Payment amount")
        if len({a.mortgage_id for a in self.allocations}) != len(self.allocations):
            raise ValueError("Each Mortgage can appear only once in a Payment")
        self.reference = (self.reference or "").strip() or None
        return self


class VoidIn(BaseModel):
    reason: str = Field(min_length=1)

    @model_validator(mode="after")
    def tidy(self) -> "VoidIn":
        self.reason = self.reason.strip()
        if not self.reason:
            raise ValueError("A reason is needed")
        return self


class TermChangeIn(BaseModel):
    """What changes; anything left out carries over from the Terms in force then."""

    effective_on: date | None = None  # an Accrual Date; None: the next one
    monthly_rate_bps: int | None = Field(default=None, gt=0, le=10_000)
    interest_mode: InterestMode | None = None
    part_month_rule: PartMonthRule | None = None


class RedeemIn(BaseModel):
    redeemed_on: date
    method: PaymentMethod  # how the final Payment was made
    reference: str | None = None


class ForfeitIn(BaseModel):
    forfeited_on: date
    recovered_amount: int = Field(ge=0)  # paise: sale price, or value if kept
    note: str = ""


# Changing these on a closed Mortgage would contradict how it was closed.
_LOCKED_WHEN_CLOSED = ["start_date", "amount_lent"]
_AUDITED_EDITS = [
    "name",
    "start_date",
    "amount_lent",
    "description",
    "gross_weight_mg",
    "net_weight_mg",
    "purity_karat",
]


def _refuse_unless_active(row: RowMapping) -> None:
    if row["status"] != MortgageStatus.ACTIVE:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"{row['name']} is {row['status']}: reopen it first",
        )


def check_replays(conn: Connection, rows: Sequence[RowMapping], today: date) -> None:
    """Replay each Mortgage; refuse if any Payment is now larger than what was owed."""
    replayed = replays(conn, rows)
    for row in rows:
        try:
            replayed[row["id"]].ledger(today)
        except Overpayment as over:
            raise unprocessable(
                f"{row['name']}: the Payment on {over.on:%d %b %Y} would be more than "
                f"the {format_inr(over.outstanding)} owed then"
            ) from None


def _write_payment(conn: Connection, payment: PaymentIn) -> int:
    payment_id: int = conn.execute(
        insert(payment_table)
        .values(**payment.model_dump(exclude={"allocations"}))
        .returning(payment_table.c.id)
    ).scalar_one()
    conn.execute(
        insert(allocation_table),
        [{"payment_id": payment_id, **a.model_dump()} for a in payment.allocations],
    )
    return payment_id


def _record_payment_history(
    conn: Connection, payment_id: int, payment: PaymentIn, now: datetime
) -> None:
    audit.record(
        conn,
        now,
        "payment",
        payment_id,
        "created",
        audit.created(
            {**payment.model_dump(), "method": payment.method.value},
            ["paid_on", "amount", "method", "reference"],
        ),
    )


def _write_void(conn: Connection, payment_id: int, reason: str, now: datetime) -> None:
    conn.execute(
        update(payment_table)
        .where(payment_table.c.id == payment_id)
        .values(voided_at=now, void_reason=reason)
    )


def _record_void_history(
    conn: Connection, payment_id: int, reason: str, now: datetime
) -> None:
    audit.record(
        conn,
        now,
        "payment",
        payment_id,
        "voided",
        [audit.Change("void_reason", None, reason)],
    )


def _refuse_payment(
    conn: Connection, payment: PaymentIn, today: date
) -> list[RowMapping]:
    """The Mortgages the Payment is allocated to, unless it cannot be made at all."""
    if payment.paid_on > today:
        raise unprocessable("The Payment date cannot be in the future")
    if not exists(conn, customer_table, payment.customer_id):
        raise unprocessable("Customer not found")
    rows = []
    for allocation in payment.allocations:
        row = (
            conn.execute(
                select(mortgage_table).where(
                    mortgage_table.c.id == allocation.mortgage_id
                )
            )
            .mappings()
            .first()
        )
        if row is None or row["customer_id"] != payment.customer_id:
            raise unprocessable("Each Mortgage must belong to the paying Customer")
        _refuse_unless_active(row)
        if payment.paid_on < row["start_date"]:
            raise unprocessable(f"{row['name']} had not started on that date")
        rows.append(row)
    return rows


def record_payment(
    conn: Connection, payment: PaymentIn, today: date, now: datetime
) -> int:
    """Record a Payment (or refuse); returns its id."""
    rows = _refuse_payment(conn, payment, today)
    payment_id = _write_payment(conn, payment)
    check_replays(conn, rows, today)
    _record_payment_history(conn, payment_id, payment, now)
    return payment_id


def void_payment(
    conn: Connection, payment_id: int, reason: str, today: date, now: datetime
) -> None:
    """Void a Payment (or refuse): a Redemption's final Payment, or one to a closed
    Mortgage, is Voided by reopening instead."""
    # Read straight from the table: loading the Payment would replay its Mortgages,
    # which Reopening has just made Active with its final Payment still in place.
    found = conn.execute(
        select(payment_table.c.voided_at).where(payment_table.c.id == payment_id)
    ).one_or_none()
    if found is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Payment not found")
    if found.voided_at is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "Already voided")
    rows = mortgages_of(conn, payment_id)
    for row in rows:
        if row["redemption_payment_id"] == payment_id:
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                f"This is the final Payment of the Redemption of {row['name']}: "
                "reopen the Mortgage instead, which voids it",
            )
        _refuse_unless_active(row)
    _write_void(conn, payment_id, reason, now)
    check_replays(conn, rows, today)
    _record_void_history(conn, payment_id, reason, now)


def add_term_change(
    conn: Connection, mortgage_id: int, change: TermChangeIn, today: date, now: datetime
) -> None:
    """Add a Term Change (or refuse)."""
    mortgage = replay(conn, mortgage_id)
    row = mortgage.row
    _refuse_unless_active(row)
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
    after = edit.model_dump()
    changed = audit.changes(before, after, _AUDITED_EDITS)
    if before["status"] != MortgageStatus.ACTIVE and any(
        c.field in _LOCKED_WHEN_CLOSED for c in changed
    ):
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"{before['name']} is {before['status']}: reopen it to change its "
            "start date or Principal",
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


def closable(
    conn: Connection, mortgage_id: int, on: date, today: date, quote_only: bool = False
) -> MortgageReplay:
    """The Mortgage, if it can be closed on `on` (or, for a quote, could be then)."""
    mortgage = replay(conn, mortgage_id)
    row = mortgage.row
    if row["status"] != MortgageStatus.ACTIVE:
        raise unprocessable(f"{row['name']} is already {row['status']}")
    if on > today and not quote_only:
        raise unprocessable(
            "A Redemption or Forfeiture cannot be recorded for a future date"
        )
    if on < row["start_date"]:
        raise unprocessable(f"{row['name']} had not started on that date")
    later = max((a.on for a in mortgage.allocations if a.on > on), default=None)
    if later is not None:
        raise unprocessable(
            f"There are Payments after that date (latest {later:%d %b %Y}); "
            "close it on or after then"
        )
    return mortgage


def _set_closure(conn: Connection, mortgage_id: int, **values: object) -> None:
    conn.execute(
        update(mortgage_table)
        .where(mortgage_table.c.id == mortgage_id)
        .values(**values)
    )


def redeem(
    conn: Connection, mortgage_id: int, redeem: RedeemIn, today: date, now: datetime
) -> None:
    """Record the final Payment of the Redemption Amount (unless nothing is owed) and
    mark the Mortgage Redeemed (or refuse)."""
    mortgage = closable(conn, mortgage_id, redeem.redeemed_on, today)
    row = mortgage.row
    owed = mortgage.redemption(redeem.redeemed_on).total
    # The final Payment includes the part-month charge, owed only once the Mortgage
    # closes, so it is replayed after closing rather than as an ordinary Payment.
    final = None
    payment_id = None
    if owed > 0:
        final = PaymentIn(
            customer_id=row["customer_id"],
            paid_on=redeem.redeemed_on,
            amount=owed,
            method=redeem.method,
            reference=redeem.reference,
            allocations=[AllocationIn(mortgage_id=mortgage_id, amount=owed)],
        )
        _refuse_payment(conn, final, today)
        payment_id = _write_payment(conn, final)
    _set_closure(
        conn,
        mortgage_id,
        status=MortgageStatus.REDEEMED,
        closed_on=redeem.redeemed_on,
        redemption_payment_id=payment_id,
    )
    check_replays(conn, [mortgage_row(conn, mortgage_id)], today)
    if final is not None and payment_id is not None:
        _record_payment_history(conn, payment_id, final, now)
    audit.record(
        conn,
        now,
        "mortgage",
        mortgage_id,
        "redeemed",
        note=f"on {redeem.redeemed_on:%d %b %Y} for {format_inr(owed)}",
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


def reopen(
    conn: Connection, mortgage_id: int, reason: str, today: date, now: datetime
) -> None:
    """Undo a Redemption or Forfeiture (or refuse); a Redemption's final Payment is
    Voided once the Mortgage is Active again."""
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


def remove_term_change(
    conn: Connection, mortgage_id: int, change_id: int, today: date, now: datetime
) -> None:
    """Remove a Term Change that has not taken effect yet (or refuse)."""
    row = mortgage_row(conn, mortgage_id)
    _refuse_unless_active(row)
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


@router.post("/mortgages/{mortgage_id}/redeem")
def post_redeem(
    mortgage_id: int, body: RedeemIn, engine: EngineDep, today: TodayDep, now: NowDep
) -> Mortgage:
    """Record the final Payment of the Redemption Amount and mark the Mortgage Redeemed."""
    with engine.begin() as conn:
        redeem(conn, mortgage_id, body, today, now)
        return load_mortgage(conn, mortgage_id, today)


@router.post("/mortgages/{mortgage_id}/forfeit")
def post_forfeit(
    mortgage_id: int, body: ForfeitIn, engine: EngineDep, today: TodayDep, now: NowDep
) -> Mortgage:
    """Mark the Mortgage Forfeited, recording what the jewellery recovered."""
    with engine.begin() as conn:
        forfeit(conn, mortgage_id, body, today, now)
        return load_mortgage(conn, mortgage_id, today)


@router.post("/mortgages/{mortgage_id}/reopen")
def post_reopen(
    mortgage_id: int, body: VoidIn, engine: EngineDep, today: TodayDep, now: NowDep
) -> Mortgage:
    """Undo a Redemption or Forfeiture; a Redemption's final Payment is Voided."""
    with engine.begin() as conn:
        reopen(conn, mortgage_id, body.reason, today, now)
        return load_mortgage(conn, mortgage_id, today)
