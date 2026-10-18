"""Today's date, injectable so tests can pin it (business dates follow the TZ setting)."""

from collections.abc import Callable
from datetime import date, datetime
from typing import Annotated

from fastapi import Depends, Query, Request


def get_today(request: Request) -> date:
    """FastAPI dependency: today's business date."""
    today: Callable[[], date] = request.app.state.today
    return today()


TodayDep = Annotated[date, Depends(get_today)]


def get_now(request: Request) -> datetime:
    """FastAPI dependency: the current local time, for audit entries."""
    now: Callable[[], datetime] = request.app.state.now
    return now()


NowDep = Annotated[datetime, Depends(get_now)]


# A calendar month as a query parameter, e.g. 2026-04.
MonthQuery = Annotated[str | None, Query(pattern=r"^\d{4}-(0[1-9]|1[0-2])$")]


def month_span(month: str) -> tuple[date, date]:
    """The first and last days of a YYYY-MM month."""
    first = date.fromisoformat(f"{month}-01")
    after = date(first.year + first.month // 12, first.month % 12 + 1, 1)
    return first, date.fromordinal(after.toordinal() - 1)
