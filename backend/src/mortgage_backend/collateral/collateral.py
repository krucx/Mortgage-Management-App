"""Gold Rates, Collateral Value and Loan-to-Value (see GLOSSARY.md)."""

from datetime import date
from typing import Literal, get_args

from fastapi import APIRouter
from pydantic import BaseModel, Field
from sqlalchemy.engine import Connection, RowMapping

from mortgage_backend.platform.clock import TodayDep
from mortgage_backend.platform.db import EngineDep
from mortgage_backend.platform.settings import ConfigGroup

Purity = Literal[24, 22, 20, 18, 14]
PURITIES: tuple[int, ...] = get_args(Purity)


class GoldRate(BaseModel):
    purity_karat: Purity
    rate_per_gram: int | None  # paise
    updated_on: date | None


class GoldRateIn(BaseModel):
    purity_karat: Purity
    rate_per_gram: int = Field(gt=0)  # paise


class Collateral(BaseModel):
    value: int  # paise
    source: Literal["gold_rate", "manual"]
    set_on: date  # when the Gold Rate or the manual value was last set
    loan_to_value: float  # Outstanding ÷ Collateral Value


class _StoredGoldRate(BaseModel):
    rate_per_gram: int | None = None  # paise
    updated_on: date | None = None


# One group per purity, unset until the Lender sets it.
_GOLD_RATES = {
    purity: ConfigGroup(
        _StoredGoldRate,
        {
            "rate_per_gram": f"gold_rate_{purity}",
            "updated_on": f"gold_rate_{purity}_updated_on",
        },
    )
    for purity in PURITIES
}


def gold_rates(conn: Connection) -> dict[int, GoldRate]:
    return {
        purity: GoldRate(purity_karat=purity, **dict(group.get(conn)))
        for purity, group in _GOLD_RATES.items()
    }


def collateral_of(
    row: RowMapping, rates: dict[int, GoldRate], outstanding: int
) -> Collateral | None:
    """A Mortgage's Collateral Value: set by hand, else net weight at its Gold Rate."""
    if row["collateral_override"] is not None:
        value, source, set_on = (
            row["collateral_override"],
            "manual",
            row["collateral_override_on"],
        )
    else:
        rate = rates[row["purity_karat"]]
        if rate.rate_per_gram is None or rate.updated_on is None:
            return None
        milligrams_per_gram = 1000
        # rounded half-up to the paisa
        value = (
            2 * row["net_weight_mg"] * rate.rate_per_gram + milligrams_per_gram
        ) // (2 * milligrams_per_gram)
        source, set_on = "gold_rate", rate.updated_on
    return Collateral(
        value=value,
        source=source,
        set_on=set_on,
        loan_to_value=outstanding / value,
    )


router = APIRouter(prefix="/api")


@router.get("/settings/gold-rates")
def read_gold_rates(engine: EngineDep) -> list[GoldRate]:
    with engine.connect() as conn:
        return list(gold_rates(conn).values())


@router.put("/settings/gold-rates")
def update_gold_rates(
    rates: list[GoldRateIn], engine: EngineDep, today: TodayDep
) -> list[GoldRate]:
    """Set the given Gold Rates; a rate's date moves only when the rate changes."""
    with engine.begin() as conn:
        current = gold_rates(conn)
        for rate in rates:
            if current[rate.purity_karat].rate_per_gram != rate.rate_per_gram:
                _GOLD_RATES[rate.purity_karat].set(
                    conn,
                    _StoredGoldRate(rate_per_gram=rate.rate_per_gram, updated_on=today),
                    today,
                )
        return list(gold_rates(conn).values())
