"""The Cash Limit (see GLOSSARY.md): at or above it the Lender is warned, on screen,
before lending or receiving cash. Only a warning: no Payment or Mortgage is refused
for it, so nothing here is checked when saving."""

from fastapi import APIRouter
from pydantic import BaseModel, Field
from sqlalchemy.engine import Connection

from mortgage_backend.platform.db import EngineDep, get_config, set_config

# Kept as text; an empty value means the Lender cleared it (no warning), while no
# value at all means it was never set. (Not a ConfigGroup: that forgets a field set to
# None, which would bring the default back.)
_KEY = "cash_limit"
DEFAULT_CASH_LIMIT = 20_000_00  # paise


class CashLimit(BaseModel):
    cash_limit: int | None = Field(gt=0)  # paise; None: never warn


def get_cash_limit(conn: Connection) -> CashLimit:
    stored = get_config(conn, [_KEY]).get(_KEY)
    if stored is None:
        return CashLimit(cash_limit=DEFAULT_CASH_LIMIT)
    return CashLimit(cash_limit=int(stored) if stored else None)


router = APIRouter(prefix="/api")


@router.get("/settings/cash-limit")
def read_cash_limit(engine: EngineDep) -> CashLimit:
    with engine.connect() as conn:
        return get_cash_limit(conn)


@router.put("/settings/cash-limit")
def update_cash_limit(cash_limit: CashLimit, engine: EngineDep) -> CashLimit:
    with engine.begin() as conn:
        value = cash_limit.cash_limit
        set_config(conn, _KEY, "" if value is None else str(value))
        return get_cash_limit(conn)
