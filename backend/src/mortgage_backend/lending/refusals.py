"""Refusals and checks shared by every change, whichever package makes it: a closed
Mortgage is refused, a Payment that would end up larger than what was owed is refused
after the Replay, and a refusal among several Mortgages names the one."""

from collections.abc import Iterator, Sequence
from contextlib import contextmanager
from datetime import date

from sqlalchemy.engine import Connection, RowMapping

from mortgage_backend.lending.ledger import Overpayment
from mortgage_backend.lending.replay import MortgageStatus, mortgage_row, replays
from mortgage_backend.platform.errors import Refusal
from mortgage_backend.platform.money import format_inr


def refuse_unless_active(row: RowMapping) -> None:
    if row["status"] != MortgageStatus.ACTIVE:
        raise Refusal(
            f"{row['name']} is {row['status']}: reopen it first",
            "conflict",
        )


def check_replays(conn: Connection, rows: Sequence[RowMapping], today: date) -> None:
    """Replay each Mortgage; refuse if any Payment is now larger than what was owed."""
    replayed = replays(conn, rows)
    for row in rows:
        try:
            replayed[row["id"]].ledger(today)
        except Overpayment as over:
            raise Refusal(
                f"{row['name']}: the Payment on {over.on:%d %b %Y} would be more than "
                f"the {format_inr(over.outstanding)} owed then",
                "unprocessable",
            ) from None


@contextmanager
def refusal_names_mortgage(conn: Connection, mortgage_id: int) -> Iterator[None]:
    """A refusal of one of several Mortgages says which, unless it already does."""
    try:
        yield
    except Refusal as refused:
        name = mortgage_row(conn, mortgage_id)["name"]
        if name not in refused.message:
            refused.message = f"{name}: {refused.message}"
        raise
