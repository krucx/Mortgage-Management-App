"""The Mortgage replay: a Mortgage's stored facts replayed into its Ledger (ADR 0001).

Every Ledger, Outstanding and Redemption Amount is read through here, so the rules for
what a replay includes live in one place: a Voided Payment is in no Ledger, a closed
Mortgage accrues nothing after its Closure, a Forfeited Mortgage's debt is settled by
its jewellery, and a Redemption Amount leaves out the Redemption's own final Payment.
"""

from collections.abc import Sequence
from datetime import date
from enum import StrEnum

from fastapi import HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.engine import Connection, RowMapping

from mortgage_backend.db import (
    allocation_table,
    mortgage_table,
    payment_table,
    term_change_table,
)
from mortgage_backend.ledger import (
    Allocation,
    HypotheticalPayments,
    LedgerStep,
    Projected,
    TermChange,
    compute_ledger,
    days_since_accrual,
    project,
    terms_on,
)
from mortgage_backend.terms import Terms


class MortgageStatus(StrEnum):
    ACTIVE = "active"
    REDEEMED = "redeemed"
    FORFEITED = "forfeited"


class Outstanding(BaseModel):
    """Principal plus unpaid interest on a date, before any Part-Month Rule charge."""

    principal: int
    unpaid_interest: int
    total: int


class Redemption(BaseModel):
    """What it takes to close a Mortgage on a date (see Redemption Amount in GLOSSARY.md)."""

    on: date
    principal: int
    unpaid_interest: int
    part_month_days: int  # since the last Accrual Date
    part_month_charge: int  # per the Part-Month Rule
    total: int  # the Redemption Amount


class MortgageReplay:
    """One Mortgage's stored facts, loaded once, and what they replay to."""

    def __init__(
        self,
        row: RowMapping,
        allocations: Sequence[Allocation],
        term_changes: Sequence[TermChange],
    ) -> None:
        self.row = row
        self.allocations = list(allocations)  # non-Voided, in no particular order
        self.term_changes = list(term_changes)  # in date order
        self._terms = Terms(
            monthly_rate_bps=row["monthly_rate_bps"],
            interest_mode=row["interest_mode"],
            part_month_rule=row["part_month_rule"],
        )
        self._ledgers: dict[date, list[LedgerStep]] = {}  # each Ledger built, by as_of

    def terms_on(self, day: date) -> Terms:
        """The Terms for a month starting on `day`, Term Changes included."""
        return terms_on(self._terms, self.term_changes, day)

    def ledger(self, as_of: date) -> list[LedgerStep]:
        """The Ledger up to `as_of` (or the Closure, if earlier).

        Raises Overpayment if any Allocation is larger than what was owed on its date.
        """
        if as_of not in self._ledgers:  # the facts never change, so neither does it
            self._ledgers[as_of] = self._replay(
                as_of,
                self.allocations,
                closed_on=self.row["closed_on"],
                forfeited=self.row["status"] == MortgageStatus.FORFEITED,
            )
        return list(self._ledgers[as_of])

    def steps_by_payment(self, up_to: date | None = None) -> dict[int, LedgerStep]:
        """How each of its Payments was applied: the Ledger step it made, by Payment id,
        for those up to `up_to` (every one, without it). A Voided Payment is in no
        Ledger, so it is not here."""
        if up_to is None:
            if not self.allocations:
                return {}
            up_to = max(allocation.on for allocation in self.allocations)
        return {
            step.payment_id: step
            for step in self.ledger(up_to)
            if step.payment_id is not None
        }

    def outstanding(self, on: date) -> Outstanding:
        """What the Mortgage owes on `on`: nothing once Redeemed or Forfeited."""
        last = self.ledger(on)[-1]
        return Outstanding(
            principal=last.principal,
            unpaid_interest=last.unpaid_interest,
            total=last.principal + last.unpaid_interest,
        )

    def redemption(self, on: date) -> Redemption:
        """The Redemption Amount if closed on `on`, leaving out the Redemption's own
        final Payment."""
        final_payment = self.row["redemption_payment_id"]
        ledger = self._replay(
            on,
            [a for a in self.allocations if a.payment_id != final_payment],
            closed_on=on,
            forfeited=False,
        )
        last = ledger[-1]
        part_month = next((s for s in ledger if s.event == "part_month"), None)
        charge = part_month.amount if part_month else 0
        return Redemption(
            on=on,
            principal=last.principal,
            unpaid_interest=last.unpaid_interest - charge,
            part_month_days=days_since_accrual(self.row["start_date"], on),
            part_month_charge=charge,
            total=last.principal + last.unpaid_interest,
        )

    def projection(
        self,
        dates: Sequence[date],
        hypothetical: HypotheticalPayments | None = None,
        paid_off_by: date | None = None,
    ) -> Projected:
        """An Active Mortgage continued past its Payments in one replay: where it stands
        on each of `dates`, the Term Changes taking effect, and when the hypothetical
        Payments would pay it off (looking as far as `paid_off_by`)."""
        return project(
            self.row["start_date"],
            self.row["amount_lent"],
            self._terms,
            dates,
            self.allocations,
            self.term_changes,
            hypothetical,
            paid_off_by,
        )

    def _replay(
        self,
        as_of: date,
        allocations: Sequence[Allocation],
        closed_on: date | None,
        forfeited: bool,
    ) -> list[LedgerStep]:
        return compute_ledger(
            self.row["start_date"],
            self.row["amount_lent"],
            self._terms,
            as_of,
            allocations,
            closed_on=closed_on,
            forfeited=forfeited,
            term_changes=self.term_changes,
        )


def replays(conn: Connection, rows: Sequence[RowMapping]) -> dict[int, MortgageReplay]:
    """A replay for each Mortgage row, loading all their facts in two queries."""
    ids = [row["id"] for row in rows]
    allocations: dict[int, list[Allocation]] = {id_: [] for id_ in ids}
    for allocation in conn.execute(
        select(
            allocation_table.c.mortgage_id,
            allocation_table.c.amount,
            allocation_table.c.payment_id,
            payment_table.c.paid_on,
        )
        .join(payment_table, payment_table.c.id == allocation_table.c.payment_id)
        .where(
            allocation_table.c.mortgage_id.in_(ids),
            payment_table.c.voided_at.is_(None),  # a Voided Payment is in no Ledger
        )
    ):
        allocations[allocation.mortgage_id].append(
            Allocation(
                on=allocation.paid_on,
                amount=allocation.amount,
                payment_id=allocation.payment_id,
            )
        )
    changes: dict[int, list[TermChange]] = {id_: [] for id_ in ids}
    for change in conn.execute(
        select(term_change_table)
        .where(term_change_table.c.mortgage_id.in_(ids))
        .order_by(term_change_table.c.effective_on)
    ).mappings():
        changes[change["mortgage_id"]].append(
            TermChange(
                change["effective_on"],
                change["monthly_rate_bps"],
                change["interest_mode"],
                change["part_month_rule"],
                id=change["id"],
            )
        )
    return {
        row["id"]: MortgageReplay(row, allocations[row["id"]], changes[row["id"]])
        for row in rows
    }


def mortgage_row(conn: Connection, mortgage_id: int) -> RowMapping:
    """The stored Mortgage; 404 if there is no such Mortgage."""
    row = (
        conn.execute(select(mortgage_table).where(mortgage_table.c.id == mortgage_id))
        .mappings()
        .first()
    )
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Mortgage not found")
    return row


def replay(conn: Connection, mortgage_id: int) -> MortgageReplay:
    """One Mortgage's replay; 404 if there is no such Mortgage."""
    return replays(conn, [mortgage_row(conn, mortgage_id)])[mortgage_id]
