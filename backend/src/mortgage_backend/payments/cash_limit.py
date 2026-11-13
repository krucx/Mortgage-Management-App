"""The Cash Limit (see Documentation/GLOSSARY.md): at or above it the Lender is warned, on screen,
before lending or receiving cash. Only a warning: no Payment or Mortgage is refused
for it, so nothing here is checked when saving. What a change writes in cash is worked
out here, for its Preview."""

from typing import NamedTuple

from fastapi import APIRouter
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.engine import Connection

from mortgage_backend.platform.db import EngineDep, mortgage_table, payment_table
from mortgage_backend.platform.settings import ThresholdSetting

_KEY = "cash_limit"
DEFAULT_CASH_LIMIT = 20_000_00  # paise


class CashLimit(BaseModel):
    cash_limit: int | None = Field(gt=0)  # paise; None: never warn


_CASH_LIMIT = ThresholdSetting(CashLimit, "cash_limit", _KEY, DEFAULT_CASH_LIMIT)


def get_cash_limit(conn: Connection) -> CashLimit:
    return _CASH_LIMIT.get(conn)


class Lent(NamedTuple):
    lent_through: str | None
    amount_lent: int  # paise


class CashBefore(NamedTuple):
    """What was written before a change, to tell what it writes in cash."""

    last_payment_id: int
    lent: dict[int, Lent]  # by Mortgage


def before_change(conn: Connection) -> CashBefore:
    """The Payments and Mortgages as they stand, before a change is made."""
    last = conn.execute(select(func.max(payment_table.c.id))).scalar_one()
    rows = conn.execute(
        select(
            mortgage_table.c.id,
            mortgage_table.c.lent_through,
            mortgage_table.c.amount_lent,
        )
    )
    return CashBefore(
        last or 0, {r.id: Lent(r.lent_through, r.amount_lent) for r in rows}
    )


def _lends_more_cash(was: Lent | None, amount_lent: int) -> bool:
    """Whether Principal now lent in cash is new, newly in cash, or larger."""
    return was is None or was.lent_through != "cash" or amount_lent > was.amount_lent


def cash_sums(conn: Connection, before: CashBefore) -> list[int]:
    """The sums the change since `before` wrote in cash: each new Payment, its parts
    together (its Final Payments included), and each Mortgage's Principal lent in cash
    that is new, newly in cash, or larger."""
    paid: dict[int, int] = {}
    for part in conn.execute(
        select(
            payment_table.c.id, payment_table.c.received_with, payment_table.c.amount
        )
        .where(
            payment_table.c.id > before.last_payment_id,
            payment_table.c.method == "cash",
            payment_table.c.voided_at.is_(None),
        )
        .order_by(payment_table.c.id)
    ):
        payment = part.received_with or part.id
        paid[payment] = paid.get(payment, 0) + part.amount
    lent = [
        row.amount_lent
        for row in conn.execute(
            select(mortgage_table.c.id, mortgage_table.c.amount_lent)
            .where(mortgage_table.c.lent_through == "cash")
            .order_by(mortgage_table.c.id)
        )
        if _lends_more_cash(before.lent.get(row.id), row.amount_lent)
    ]
    return [*paid.values(), *lent]


router = APIRouter(prefix="/api")


@router.get("/settings/cash-limit")
def read_cash_limit(engine: EngineDep) -> CashLimit:
    with engine.connect() as conn:
        return get_cash_limit(conn)


@router.put("/settings/cash-limit")
def update_cash_limit(cash_limit: CashLimit, engine: EngineDep) -> CashLimit:
    with engine.begin() as conn:
        _CASH_LIMIT.set(conn, cash_limit)
        return get_cash_limit(conn)
