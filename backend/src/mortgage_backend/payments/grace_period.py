"""The Grace Period (see Documentation/GLOSSARY.md): the days after an Accrual Date within
which a Payment may be dated the day before it, as if paid on time. One setting for the
whole book, not part of any Mortgage's Terms; off unless the Lender sets it.

A Payment dated that way keeps the amount it let off on each Mortgage, as worked out
when it was saved (ADR 0020)."""

from collections.abc import Mapping, Sequence
from datetime import date, timedelta

from fastapi import APIRouter
from pydantic import (
    BaseModel,
    ValidationError,
    ValidatorFunctionWrapHandler,
    field_validator,
)
from sqlalchemy import select
from sqlalchemy.engine import Connection

from mortgage_backend.lending.ledger import Allocation, accrual_date
from mortgage_backend.lending.replay import MortgageReplay
from mortgage_backend.platform.clock import TodayDep
from mortgage_backend.platform.db import EngineDep, allocation_table, payment_table
from mortgage_backend.platform.settings import ConfigGroup


class GracePeriod(BaseModel):
    grace_period_days: int | None = None  # None: no Grace

    @field_validator("grace_period_days", mode="wrap")
    @classmethod
    def whole_days(
        cls, days: object, as_days: ValidatorFunctionWrapHandler
    ) -> int | None:
        """0 days is no Grace, as is none; anything but a whole number of days is refused
        (true and false included, which would otherwise pass as 1 and 0)."""
        refused = ValueError("The Grace Period must be a whole number of days, 0 or more")
        if isinstance(days, bool):
            raise refused
        try:
            whole: int | None = as_days(days)
        except ValidationError:
            raise refused from None
        if whole is not None and whole < 0:
            raise refused
        return whole or None


# Nothing stored means off, so clearing it can simply forget it.
_GRACE_PERIOD = ConfigGroup.prefixed("", GracePeriod)


def get_grace_period(conn: Connection) -> GracePeriod:
    return _GRACE_PERIOD.get(conn)


class MortgageLetOff(BaseModel):
    mortgage_id: int
    let_off: int  # paise


class LedgerGrace(BaseModel):
    """A Grace Payment as it stands in one Mortgage's Ledger."""

    payment_id: int
    received_on: date  # after the Payment's date
    let_off: int  # paise, on this Mortgage, as saved (ADR 0020)


def graces_of(conn: Connection, mortgage_id: int) -> list[LedgerGrace]:
    """The Grace Payments in a Mortgage's Ledger: its non-Voided ones."""
    return [
        LedgerGrace(payment_id=row.id, received_on=row.received_on, let_off=row.let_off)
        for row in conn.execute(
            select(
                payment_table.c.id,
                payment_table.c.received_on,
                allocation_table.c.let_off,
            )
            .join(allocation_table, allocation_table.c.payment_id == payment_table.c.id)
            .where(
                allocation_table.c.mortgage_id == mortgage_id,
                payment_table.c.received_on.is_not(None),
                payment_table.c.voided_at.is_(None),  # a Voided Payment is in no Ledger
            )
            .order_by(payment_table.c.paid_on, payment_table.c.id)
        )
    ]


class GraceOffer(BaseModel):
    """A Payment received on a date, dated instead the day before the Accrual Date it
    is within the Grace Period of, and what that lets off."""

    days: int  # the Grace Period
    accrual_on: date
    paid_on: date  # the day before `accrual_on`
    let_off: int  # paise, on all its Mortgages
    mortgages: list[MortgageLetOff]  # in the order of the Payment's Allocations


def _grace_accrual_date(
    starts: Sequence[date], received_on: date, days: int
) -> date | None:
    """The earliest Accrual Date (not a start date) of the Mortgages starting on
    `starts` that `received_on` is within `days` after; None if there is none, or if any
    of them started after the day before it."""
    within = []
    for start in starts:
        n = 1
        while (on := accrual_date(start, n)) <= received_on:
            if received_on <= on + timedelta(days=days):
                within.append(on)
            n += 1
    if not within:
        return None
    earliest = min(within)
    if any(start > earliest - timedelta(days=1) for start in starts):
        return None
    return earliest


def _owed_after(mortgage: MortgageReplay, paid: int, on: date, as_of: date) -> int:
    """What the Mortgage would owe on `as_of` after `paid` on `on`; anything paid beyond
    what it owed then counts against it."""
    applied = min(paid, mortgage.outstanding(on).total)
    with_it = MortgageReplay(
        mortgage.row,
        # A draft has no id yet; within a day, the order of Payments changes no total.
        [*mortgage.allocations, Allocation(on=on, amount=applied, payment_id=0)],
        mortgage.term_changes,
    )
    return with_it.outstanding(as_of).total - (paid - applied)


def grace_offer(
    mortgages: Sequence[MortgageReplay],
    paid: Mapping[int, int],
    received_on: date,
    days: int | None,
) -> GraceOffer | None:
    """The Grace for a Payment of `paid` (cash and Discount, by Mortgage id) to these
    Active Mortgages, received on `received_on`, under a Grace Period of `days`: None if
    it is not within one. Each Mortgage's amount let off is what it would owe on the
    received date, less what it would owe then had it been paid on the earlier date."""
    if days is None:
        return None
    accrual_on = _grace_accrual_date(
        [m.row["start_date"] for m in mortgages], received_on, days
    )
    if accrual_on is None:
        return None
    paid_on = accrual_on - timedelta(days=1)
    let_offs = [
        MortgageLetOff(
            mortgage_id=m.row["id"],
            # Never below nothing: nothing is let off then.
            let_off=max(
                0,
                _owed_after(m, paid[m.row["id"]], received_on, received_on)
                - _owed_after(m, paid[m.row["id"]], paid_on, received_on),
            ),
        )
        for m in mortgages
    ]
    return GraceOffer(
        days=days,
        accrual_on=accrual_on,
        paid_on=paid_on,
        let_off=sum(m.let_off for m in let_offs),
        mortgages=let_offs,
    )


router = APIRouter(prefix="/api")


@router.get("/settings/grace-period")
def read_grace_period(engine: EngineDep) -> GracePeriod:
    with engine.connect() as conn:
        return get_grace_period(conn)


@router.put("/settings/grace-period")
def update_grace_period(
    setting: GracePeriod, engine: EngineDep, today: TodayDep
) -> GracePeriod:
    with engine.begin() as conn:
        _GRACE_PERIOD.set(conn, setting, today)
        return get_grace_period(conn)
