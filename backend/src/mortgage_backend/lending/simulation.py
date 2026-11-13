"""Simulations: a made-up Mortgage worked out by the ledger engine, exactly as a real
one's Ledger would be, for the Calculator (see Documentation/GLOSSARY.md).

Nothing is written to the database: the engine replays the amount, start date, Terms
and planned Payments alone, closed on the chosen date (or the day the plan pays it
off, if sooner); only its Collateral Value, if any, is read from the Gold Rates.
"""

from datetime import date
from typing import Literal

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field, model_validator

from mortgage_backend.collateral.collateral import (
    JewelleryValueIn,
    collateral_value,
    gold_rates,
)
from mortgage_backend.lending.ledger import (
    Allocation,
    HypotheticalPayments,
    LedgerStep,
    Overpayment,
    accrual_date,
    compute_ledger,
    monthly_interest,
    paid_off_on,
    project,
)
from mortgage_backend.lending.replay import (
    OutstandingOnClosure,
    outstanding_on_closure_of,
)
from mortgage_backend.lending.terms import Terms
from mortgage_backend.platform.db import EngineDep
from mortgage_backend.platform.money import format_inr

MAX_YEARS = 10  # how long after its start a Simulation can close

# What the effective annual rate is worked out on: large enough that rounding each
# month's interest to the rupee changes nothing that shows.
_RATE_BASE = 10**15  # paise


def effective_annual_rate(start: date, terms: Terms) -> float:
    """What a sum earns in its first year under `terms` with no Payments, as a share
    of it: the interest charged on 12 Accrual Dates, capitalised or not."""
    year_on = project(start, _RATE_BASE, terms, [accrual_date(start, 12)]).snapshots[0]
    return (year_on.principal + year_on.unpaid_interest - _RATE_BASE) / _RATE_BASE


class LumpSum(BaseModel):
    on: date
    amount: int = Field(gt=0)  # paise


class SimulationIn(BaseModel):
    amount_lent: int = Field(gt=0)  # paise
    start_date: date
    closed_on: date  # treated as a Closure then: every figure is as of it
    terms: Terms
    # How far the graph runs from the start, stretched to `closed_on` if later
    span_months: Literal[3, 6, 12, 24, 36] = 12
    # The plan: paid on every Accrual Date, capped at what is owed, until nothing is
    monthly_payment: int | None = Field(default=None, gt=0)  # paise
    lump_sums: list[LumpSum] = []
    collateral: JewelleryValueIn | None = (
        None  # for its Loan-to-Value, if valued at all
    )

    @model_validator(mode="after")
    def closes_after_it_starts(self) -> "SimulationIn":
        if self.closed_on <= self.start_date:
            raise ValueError("Closed on must be after the start date")
        if self.closed_on > accrual_date(self.start_date, 12 * MAX_YEARS):
            raise ValueError(
                f"Closed on must be at most {MAX_YEARS} years after the start date"
            )
        if any(lump.on < self.start_date for lump in self.lump_sums):
            raise ValueError("A Lump Sum must be on or after the start date")
        return self

    def allocations(self) -> list[Allocation]:
        """The Lump Sums by Closed on, each as a Payment numbered by its place."""
        return [
            Allocation(on=lump.on, amount=lump.amount, payment_id=n)
            for n, lump in enumerate(self.lump_sums)
            if lump.on <= self.closed_on
        ]

    def hypothetical(self) -> HypotheticalPayments | None:
        if self.monthly_payment is None:
            return None
        return HypotheticalPayments(after=self.start_date, amount=self.monthly_payment)


class SimulatedPoint(BaseModel):
    on: date
    outstanding: int  # what would redeem it that day, if still open until then


class SimulatedPayment(BaseModel):
    on: date
    amount: int  # paise; a monthly payment is capped at what is owed


class PlannedLumpSum(LumpSum):
    # Why it is left out: dated after Closed on, or after the plan has paid it off
    ignored: Literal["after_closed_on", "after_paid_off"] | None


class SimulatedMonth(BaseModel):
    """A month's interest charged on an Accrual Date, a planned Payment or, last, the
    Interest to Date charged on Closed on, and where it stands after (a day's
    capitalisation is shown on its last row)."""

    on: date
    interest: int
    paid: int  # a planned Payment's row: what it paid
    interest_to_date_days: int | None  # the last row: days of the month charged
    capitalised: int
    principal: int
    unpaid_interest: int


class Simulation(BaseModel):
    on_closure: OutstandingOnClosure  # what would redeem it on `closed_on`
    interest_earned: int  # charged by `closed_on`, its Interest to Date included
    first_month_interest: int
    effective_annual_rate: float  # e.g. 0.24: what it earns in a year, as a share
    # When the plan pays everything off, within MAX_YEARS of the start; with no plan, None
    paid_off_on: date | None
    collateral_value: int | None  # today's, as given; None without one or a Gold Rate
    loan_to_value: float | None  # Outstanding on Closure ÷ Collateral Value
    lump_sums: list[PlannedLumpSum]  # as asked, each with whether it was ignored
    # for the graph: the start, each Accrual Date and Lump Sum, Closed on; up to the
    # day it is paid off, if within the span
    points: list[SimulatedPoint]
    payments: list[SimulatedPayment]  # what the plan pays over the graph
    months: list[SimulatedMonth]  # up to Closed on, the Interest to Date last


def _graph_dates(
    simulation: SimulationIn, paid: list[Allocation], paid_off_on: date | None
) -> list[date]:
    """The start and each Accrual Date over the span (or up to Closed on, if later),
    with Closed on and each Lump Sum paid; none after the day it is paid off."""
    start, closed_on = simulation.start_date, simulation.closed_on
    end = max(accrual_date(start, simulation.span_months), closed_on)
    if paid_off_on is not None:
        end = min(end, paid_off_on)
    dates = {closed_on, *(lump.on for lump in paid)}
    if paid_off_on is not None:
        dates.add(paid_off_on)
    n = 0
    while (on := accrual_date(start, n)) <= end:
        dates.add(on)
        n += 1
    return sorted(on for on in dates if on <= end)


class _Plan:
    """The planned Payments as they would be paid: the Lump Sums by Closed on and up to
    the day they pay it off, with the monthly payment, replayed for MAX_YEARS.

    Raises Overpayment if a Lump Sum is more than is owed on its date, before the plan
    has paid everything off.
    """

    def __init__(self, simulation: SimulationIn) -> None:
        self.simulation = simulation
        asked = simulation.allocations()
        self.ledger = self._replay(
            accrual_date(simulation.start_date, 12 * MAX_YEARS),
            asked,
            stop_when_paid_off=True,
        )
        self.paid_off_on = paid_off_on(self.ledger)
        # The engine leaves out whatever came after it was paid off (ADR: the Simulation
        # has no paid-off rule of its own).
        applied = {step.payment_id for step in self.ledger if step.event == "payment"}
        self.after_paid_off = {
            a.payment_id for a in asked if a.payment_id not in applied
        }
        self.paid = [a for a in asked if a.payment_id in applied]

    def _replay(
        self,
        on: date,
        paid: list[Allocation],
        closed: bool = False,
        stop_when_paid_off: bool = False,
    ) -> list[LedgerStep]:
        simulation = self.simulation
        return compute_ledger(
            simulation.start_date,
            simulation.amount_lent,
            simulation.terms,
            on,
            allocations=paid,
            closed_on=on if closed else None,
            hypothetical=simulation.hypothetical(),
            stop_when_paid_off=stop_when_paid_off,
        )

    def ends_on(self) -> date:
        """Closed on, or the day the plan pays it off if sooner."""
        closed_on = self.simulation.closed_on
        if self.paid_off_on is not None and self.paid_off_on < closed_on:
            return self.paid_off_on
        return closed_on

    def closed(self) -> list[LedgerStep]:
        """The Ledger as if closed on the day it ends."""
        on = self.ends_on()
        return self._replay(on, self.paid, closed=True)

    def lump_sums(self) -> list[PlannedLumpSum]:
        closed_on = self.simulation.closed_on
        return [
            PlannedLumpSum(
                on=lump.on,
                amount=lump.amount,
                ignored=(
                    "after_closed_on"
                    if lump.on > closed_on
                    else "after_paid_off"
                    if n in self.after_paid_off
                    else None
                ),
            )
            for n, lump in enumerate(self.simulation.lump_sums)
        ]


def _months(
    ledger: list[LedgerStep], closure: OutstandingOnClosure
) -> list[SimulatedMonth]:
    months: list[SimulatedMonth] = []
    for step in ledger:
        if step.event == "interest":
            months.append(
                SimulatedMonth(
                    on=step.on,
                    interest=step.amount,
                    paid=0,
                    interest_to_date_days=None,
                    capitalised=0,
                    principal=step.principal,
                    unpaid_interest=step.unpaid_interest,
                )
            )
        elif step.event == "payment":
            months.append(
                SimulatedMonth(
                    on=step.on,
                    interest=0,
                    paid=step.amount,
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
            paid=0,
            interest_to_date_days=closure.interest_to_date_days,
            capitalised=0,
            principal=closure.principal,
            unpaid_interest=closure.total - closure.principal,
        )
    )
    return months


router = APIRouter(prefix="/api")


def _collateral_value(simulation: SimulationIn, engine: EngineDep) -> int | None:
    if simulation.collateral is None:
        return None
    with engine.connect() as conn:
        rates = gold_rates(conn)
    return collateral_value(
        simulation.collateral.net_weight_mg,
        simulation.collateral.purity_karat,
        simulation.collateral.override,
        rates,
    )


@router.post("/simulation")
def simulate(simulation: SimulationIn, engine: EngineDep) -> Simulation:
    """A Simulation closed on `closed_on`, or on the day its plan pays it off if
    sooner; nothing is stored. A Lump Sum larger than what is owed on its date is
    refused, as a real Payment would be."""
    start = simulation.start_date
    try:
        plan = _Plan(simulation)
    except Overpayment as over:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            {
                "lump_sum": over.payment_id,
                "owed": over.outstanding,
                "on": over.on.isoformat(),
                "message": (
                    f"The Lump Sum on {over.on:%d %b %Y} is more than the "
                    f"{format_inr(over.outstanding)} owed then"
                ),
            },
        ) from over
    ledger = plan.closed()
    closure = outstanding_on_closure_of(ledger, start, plan.ends_on())
    dates = _graph_dates(simulation, plan.paid, plan.paid_off_on)
    projected = project(
        start,
        simulation.amount_lent,
        simulation.terms,
        dates,
        allocations=plan.paid,
        hypothetical=simulation.hypothetical(),
    )
    value = _collateral_value(simulation, engine)
    return Simulation(
        on_closure=closure,
        interest_earned=sum(
            step.amount
            for step in ledger
            if step.event in ("interest", "interest_to_date")
        ),
        first_month_interest=monthly_interest(simulation.amount_lent, simulation.terms),
        effective_annual_rate=effective_annual_rate(start, simulation.terms),
        paid_off_on=plan.paid_off_on,
        collateral_value=value,
        loan_to_value=closure.total / value if value else None,
        lump_sums=plan.lump_sums(),
        points=[
            SimulatedPoint(on=point.on, outstanding=point.outstanding)
            for point in projected.snapshots
        ],
        payments=[
            SimulatedPayment(on=step.on, amount=step.amount)
            for step in plan.ledger
            if step.event == "payment" and step.on <= dates[-1]
        ],
        months=_months(ledger, closure),
    )
