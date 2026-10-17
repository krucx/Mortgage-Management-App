"""Terms: a Mortgage's rate, Interest Mode and Part-Month Rule (see GLOSSARY.md)."""

from enum import StrEnum

from pydantic import BaseModel, Field


class InterestMode(StrEnum):
    SIMPLE = "simple"
    COMPOUNDED_YEARLY = "compounded_yearly"
    COMPOUNDED_MONTHLY = "compounded_monthly"


class PartMonthRule(StrEnum):
    PRO_RATA = "pro_rata"
    FULL_MONTH = "full_month"
    NOTHING = "nothing"


class Terms(BaseModel):
    # Basis points per month: 300 = 3% a month. Integers avoid float drift.
    monthly_rate_bps: int = Field(gt=0, le=10_000)
    interest_mode: InterestMode
    part_month_rule: PartMonthRule
