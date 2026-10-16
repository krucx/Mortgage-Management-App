"""The default Terms copied into every new Mortgage (see GLOSSARY.md)."""

from enum import StrEnum

from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.dialects.sqlite import insert
from sqlalchemy.engine import Connection

from mortgage_backend.db import config_table


class InterestMode(StrEnum):
    SIMPLE = "simple"
    COMPOUNDED_YEARLY = "compounded_yearly"
    COMPOUNDED_MONTHLY = "compounded_monthly"


class PartMonthRule(StrEnum):
    PRO_RATA = "pro_rata"
    FULL_MONTH = "full_month"
    NOTHING = "nothing"


class DefaultTerms(BaseModel):
    # Basis points per month: 300 = 3% a month. Integers avoid float drift.
    monthly_rate_bps: int = Field(gt=0, le=10_000)
    interest_mode: InterestMode
    part_month_rule: PartMonthRule


_CONFIG_KEY_BY_FIELD = {
    "monthly_rate_bps": "default_monthly_rate_bps",
    "interest_mode": "default_interest_mode",
    "part_month_rule": "default_part_month_rule",
}


def get_default_terms(conn: Connection) -> DefaultTerms:
    rows = conn.execute(
        select(config_table.c.key, config_table.c.value).where(
            config_table.c.key.in_(_CONFIG_KEY_BY_FIELD.values())
        )
    )
    values = {key: value for key, value in rows}
    return DefaultTerms(**{field: values[key] for field, key in _CONFIG_KEY_BY_FIELD.items()})


def set_default_terms(conn: Connection, terms: DefaultTerms) -> None:
    for field, key in _CONFIG_KEY_BY_FIELD.items():
        value = str(getattr(terms, field))
        conn.execute(
            insert(config_table)
            .values(key=key, value=value)
            .on_conflict_do_update(index_elements=["key"], set_={"value": value})
        )
