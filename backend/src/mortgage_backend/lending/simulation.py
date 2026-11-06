"""Simulations: a made-up Mortgage worked out by the ledger engine, exactly as a real
one's Ledger would be, for the Calculator (see GLOSSARY.md).

Nothing is read from or written to the database: the engine replays the amount, start
date and Terms alone, closed on the chosen date.
"""

from datetime import date
from typing import Literal

from fastapi import APIRouter
from pydantic import BaseModel, Field, model_validator

from mortgage_backend.lending.ledger import (
    LedgerStep,
    accrual_date,
    compute_ledger,
    monthly_interest,
    project,
)
from mortgage_backend.lending.replay import (
    OutstandingOnClosure,
    outstanding_on_closure_of,
)
from mortgage_backend.lending.terms import Terms


MAX_YEARS = 10  # how long after its start a Simulation can close

# What the effective annual rate is worked out on: large enough that rounding each
# month's interest to the rupee changes nothing that shows.
_RATE_BASE = 10**15  # paise


def effective_annual_rate(start: date, terms: Terms) -> float:
    """What a sum earns in its first year under `terms` with no Payments, as a share
    of it: the interest charged on 12 Accrual Dates, capitalised or not."""
    year_on = project(start, _RATE_BASE, terms, [accrual_date(start, 12)]).snapshots[0]
    return (year_on.principal + year_on.unpaid_interest - _RATE_BASE) / _RATE_BASE


class SimulationIn(BaseModel):
    amount_lent: int = Field(gt=0)  # paise
    start_date: date
    closed_on: date  # treated as a Closure then: every figure is as of it
    terms: Terms
    # How far the graph runs from the start, stretched to `closed_on` if later
    span_months: Literal[3, 6, 12, 24, 36] = 12

    @model_validator(mode="after")
    def closes_after_it_starts(self) -> "SimulationIn":
        if self.closed_on <= self.start_date:
            raise ValueError("Closed on must be after the start date")
        if self.closed_on > accrual_date(self.start_date, 12 * MAX_YEARS):
            raise ValueError(
                f"Closed on must be at most {MAX_YEARS} years after the start date"
            )
        return self


class SimulatedPoint(BaseModel):
    on: date
    outstanding: int  # what would redeem it that day, if still open until then


class SimulatedMonth(BaseModel):
    """A month's interest charged on an Accrual Date or, last, the Interest to Date
    charged on Closed on, and where it stands after."""

    on: date
    interest: int
    interest_to_date_days: int | None  # the last row: days of the month charged
    capitalised: int
    principal: int
    unpaid_interest: int


class Simulation(BaseModel):
    on_closure: OutstandingOnClosure  # what would redeem it on `closed_on`
    interest_earned: int  # charged by `closed_on`, its Interest to Date included
    first_month_interest: int
    effective_annual_rate: float  # e.g. 0.24: what it earns in a year, as a share
    points: list[SimulatedPoint]  # for the graph: the start, each Accrual Date, Closed on
    months: list[SimulatedMonth]  # up to Closed on, the Interest to Date last


def _graph_dates(simulation: SimulationIn) -> list[date]:
    """The start and each Accrual Date over the span (or up to Closed on, if later),
    with Closed on itself."""
    start, closed_on = simulation.start_date, simulation.closed_on
    end = max(accrual_date(start, simulation.span_months), closed_on)
    dates = {closed_on}
    n = 0
    while (on := accrual_date(start, n)) <= end:
        dates.add(on)
        n += 1
    return sorted(dates)


def _months(ledger: list[LedgerStep], closure: OutstandingOnClosure) -> list[SimulatedMonth]:
    months: list[SimulatedMonth] = []
    for step in ledger:
        if step.event == "interest":
            months.append(
                SimulatedMonth(
                    on=step.on,
                    interest=step.amount,
                    interest_to_date_days=None,
                    capitalised=0,
                    principal=step.principal,
                    unpaid_interest=step.unpaid_interest,
                )
            )
        elif step.event == "capitalised":
            months[-1] = months[-1].model_copy(
                update={
                    "capitalised": step.amount,
                    "principal": step.principal,
                    "unpaid_interest": step.unpaid_interest,
                }
            )
    months.append(
        SimulatedMonth(
            on=closure.on,
            interest=closure.interest_to_date,
            interest_to_date_days=closure.interest_to_date_days,
            capitalised=0,
            principal=closure.principal,
            unpaid_interest=closure.total - closure.principal,
        )
    )
    return months


router = APIRouter(prefix="/api")


@router.post("/simulation")
def simulate(simulation: SimulationIn) -> Simulation:
    """A Simulation closed on `closed_on`; nothing is stored."""
    start, on = simulation.start_date, simulation.closed_on
    ledger = compute_ledger(
        start, simulation.amount_lent, simulation.terms, on, closed_on=on
    )
    closure = outstanding_on_closure_of(ledger, start, on)
    projected = project(
        start, simulation.amount_lent, simulation.terms, _graph_dates(simulation)
    )
    return Simulation(
        on_closure=closure,
        interest_earned=sum(
            step.amount
            for step in ledger
            if step.event in ("interest", "interest_to_date")
        ),
        first_month_interest=monthly_interest(
            simulation.amount_lent, simulation.terms
        ),
        effective_annual_rate=effective_annual_rate(start, simulation.terms),
        points=[
            SimulatedPoint(on=point.on, outstanding=point.outstanding)
            for point in projected.snapshots
        ],
        months=_months(ledger, closure),
    )
