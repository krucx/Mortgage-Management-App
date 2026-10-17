"""Gold Rates, Collateral Value and Loan-to-Value (see GLOSSARY.md)."""

from datetime import date
from typing import Literal, get_args

from fastapi import APIRouter
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.engine import Connection, RowMapping

from mortgage_backend.clock import TodayDep
from mortgage_backend.db import EngineDep, config_table, set_config

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


def _rate_key(purity: int) -> str:
    return f"gold_rate_{purity}"


def _date_key(purity: int) -> str:
    return f"gold_rate_{purity}_updated_on"


def gold_rates(conn: Connection) -> dict[int, GoldRate]:
    rows = conn.execute(
        select(config_table.c.key, config_table.c.value).where(
            config_table.c.key.like("gold_rate_%")
        )
    )
    values = {key: value for key, value in rows}
    return {
        purity: GoldRate(
            purity_karat=purity,
            rate_per_gram=values.get(_rate_key(purity)),
            updated_on=values.get(_date_key(purity)),
        )
        for purity in PURITIES
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
                set_config(conn, _rate_key(rate.purity_karat), str(rate.rate_per_gram))
                set_config(conn, _date_key(rate.purity_karat), today.isoformat())
        return list(gold_rates(conn).values())
