"""The Mortgage replay: a Mortgage's stored facts replayed into its Ledger (ADR 0001).

Every Ledger and Outstanding is read through here, so the rules for what a replay
includes live in one place: a Voided Payment is in no Ledger, a closed Mortgage accrues
nothing after its Closure, a Forfeited Mortgage's debt is settled by its jewellery and a
Waived one's is let off by the Lender, and the Outstanding on a Closure date leaves out
the Closure's own final Payment.
"""

from collections.abc import Sequence
from datetime import date, timedelta
from enum import StrEnum
from typing import Literal

from fastapi import HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.engine import Connection, RowMapping

from mortgage_backend.lending.ledger import (
    Allocation,
    HypotheticalPayments,
    LedgerStep,
    Projected,
    TermChange,
    compute_ledger,
    interest_to_date_days,
    project,
    terms_on,
)
from mortgage_backend.lending.terms import Terms
from mortgage_backend.platform.db import (
    allocation_table,
    mortgage_table,
    payment_table,
    term_change_table,
)


class MortgageStatus(StrEnum):
    ACTIVE = "active"
    REDEEMED = "redeemed"
    WAIVED = "waived"  # the Lender let off what was left; the jewellery went back
    FORFEITED = "forfeited"


class Outstanding(BaseModel):
    """What would redeem it on a date: Principal plus unpaid interest, its Interest to
    Date included (ADR 0011)."""

    principal: int
    unpaid_interest: int
    total: int


class OutstandingOnClosure(BaseModel):
    """What it takes to close a Mortgage on a date: its Outstanding on that Closure date."""

    on: date
    principal: int
    unpaid_interest: int
    last_accrual_on: date  # the last Accrual Date by `on` (the start, before any)
    interest_to_date_days: int  # of the month under way charged, `on` included
    interest_to_date: int  # per the Part-Month Rule, less what was paid ahead
    total: int  # the Outstanding on that Closure date


def outstanding_on_closure_of(
    ledger: Sequence[LedgerStep], start: date, on: date
) -> OutstandingOnClosure:
    """The Outstanding on `on` of a Ledger replayed as if closed then, with no final
    Payment."""
    last = ledger[-1]
    to_date = next((s for s in ledger if s.event == "interest_to_date"), None)
    charge = to_date.amount - to_date.paid_ahead if to_date else 0
    days = interest_to_date_days(start, on)
    return OutstandingOnClosure(
        on=on,
        principal=last.principal,
        unpaid_interest=last.unpaid_interest - charge,
        last_accrual_on=on - timedelta(days=days - 1),
        interest_to_date_days=days,
        interest_to_date=charge,
        total=last.principal + last.unpaid_interest,
    )


class Closure(BaseModel):
    """How and when a Mortgage was closed, and what it came to."""

    kind: Literal["redeemed", "waived", "forfeited"]
    on: date
    outstanding: int  # on the Closure date, before its final Payment
    interest_to_date: int  # of that Outstanding: the month under way, as yet unpaid
    interest_to_date_days: int  # days of that month, the Closure date included
    payment_id: int | None  # Redeemed or Waived: the final Payment, if any
    payment_amount: int | None  # what that final Payment paid on this Mortgage
    waived_amount: int | None  # Waived: what the Lender let off
    recovered_amount: int | None  # Forfeited: what the jewellery fetched (or is worth)
    profit_loss: int | None  # Forfeited: recovered − Outstanding on the Closure date
    note: str | None


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
                closure=None
                if self.row["status"] == MortgageStatus.ACTIVE
                else self.row["status"],
                final_payment=self.row["redemption_payment_id"],
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

    def owed_after(self, payment_id: int, on: date) -> int:
        """What it owed just after its Payment `payment_id` on `on`: Outstanding at the
        end of that day, as if none of that day's later Payments (or a write-off) had
        been made."""
        ledger = self.ledger(on)
        at = next(i for i, s in enumerate(ledger) if s.payment_id == payment_id)
        later = sum(
            s.amount + s.discount
            for s in ledger[at + 1 :]
            if s.event in ("payment", "waived", "forfeited")
        )
        return ledger[-1].principal + ledger[-1].unpaid_interest + later

    def outstanding(self, on: date) -> Outstanding:
        """What the Mortgage owes on `on`: nothing once closed."""
        last = self.ledger(on)[-1]
        return Outstanding(
            principal=last.principal,
            unpaid_interest=last.unpaid_interest,
            total=last.principal + last.unpaid_interest,
        )

    def dormant(self, on: date) -> bool:
        """Active, yet owing nothing on `on`: its jewellery should already have gone
        back (see Dormant in Documentation/GLOSSARY.md, ADR 0012)."""
        return (
            self.row["status"] == MortgageStatus.ACTIVE
            and self.outstanding(on).total == 0
        )

    def not_closable(self, on: date) -> str | None:
        """Why it can't be closed on `on`, a date not in the future; None if it can."""
        row = self.row
        if row["status"] != MortgageStatus.ACTIVE:
            return f"{row['name']} is already {row['status']}"
        if on < row["start_date"]:
            return f"{row['name']} had not started on that date"
        later = max((a.on for a in self.allocations if a.on > on), default=None)
        if later is not None:
            return (
                f"There are Payments after that date (latest {later:%d %b %Y}); "
                "close it on or after then"
            )
        return None

    def outstanding_on_closure(self, on: date) -> OutstandingOnClosure:
        """The Outstanding if closed on `on`, leaving out the Closure's own final
        Payment."""
        final_payment = self.row["redemption_payment_id"]
        ledger = self._replay(
            on,
            [a for a in self.allocations if a.payment_id != final_payment],
            closed_on=on,
        )
        return outstanding_on_closure_of(ledger, self.row["start_date"], on)

    def closure(self) -> Closure | None:
        """How it was closed and what that came to; None while Active."""
        row = self.row
        if row["status"] == MortgageStatus.ACTIVE:
            return None
        on_closure = self.outstanding_on_closure(row["closed_on"])
        outstanding = on_closure.total
        forfeited = row["status"] == MortgageStatus.FORFEITED
        last = self.ledger(row["closed_on"])[-1]
        final_payment_id = row["redemption_payment_id"]
        return Closure(
            kind=row["status"],
            on=row["closed_on"],
            outstanding=outstanding,
            interest_to_date=on_closure.interest_to_date,
            interest_to_date_days=on_closure.interest_to_date_days,
            payment_id=final_payment_id,
            payment_amount=next(
                (
                    a.amount
                    for a in self.allocations
                    if a.payment_id == final_payment_id
                ),
                None,
            ),
            waived_amount=last.amount if last.event == "waived" else None,
            recovered_amount=row["recovered_amount"],
            profit_loss=row["recovered_amount"] - outstanding if forfeited else None,
            note=row["closure_note"],
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
        closure: Literal["redeemed", "waived", "forfeited"] | None = None,
        final_payment: int | None = None,
    ) -> list[LedgerStep]:
        return compute_ledger(
            self.row["start_date"],
            self.row["amount_lent"],
            self._terms,
            as_of,
            allocations,
            closed_on=closed_on,
            closure=closure,
            term_changes=self.term_changes,
            final_payment=final_payment,
        )


def replays(conn: Connection, rows: Sequence[RowMapping]) -> dict[int, MortgageReplay]:
    """A replay for each Mortgage row, loading all their facts in two queries."""
    ids = [row["id"] for row in rows]
    allocations: dict[int, list[Allocation]] = {id_: [] for id_ in ids}
    for allocation in conn.execute(
        select(
            allocation_table.c.mortgage_id,
            allocation_table.c.amount,
            allocation_table.c.discount,
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
                discount=allocation.discount,
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


def active_replays(conn: Connection) -> dict[int, MortgageReplay]:
    """Every Active Mortgage, replayed."""
    return replays(
        conn,
        conn.execute(
            select(mortgage_table).where(
                mortgage_table.c.status == MortgageStatus.ACTIVE
            )
        )
        .mappings()
        .all(),
    )


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
