"""Today's date, injectable so tests can pin it (business dates follow the TZ setting).

In QA mode (`QA_MODE=true`, fixed at process start) the request headers
`X-QA-Clock` (`YYYY-MM-DD`) and optional `X-QA-Clock-Now` (`YYYY-MM-DDTHH:MM:SS`)
override the process clock for that request only: stateless and race-free. The
request's date also drives the daily run (Reminder queueing, the Backup-due check),
which runs each new date's jobs, earlier dates included. Outside
QA mode, or when the headers are absent, the injectable `app.state.today` /
`.now` callables are used, so unit tests that pin `create_app(today=…)` are
unaffected.
"""

import os
from collections.abc import Callable
from datetime import date, datetime
from typing import Annotated

from fastapi import Depends, HTTPException, Query, Request, status

# Fixed at process start: the QA gate is not toggleable at runtime.
_QA_MODE = os.getenv("QA_MODE") == "true"


_DAY = "%Y-%m-%d"
_TIME = "%Y-%m-%dT%H:%M:%S"


class _BadHeader(Exception):
    """A QA clock header that doesn't parse; the dependency answers 400, naming it."""


def _header(request: Request, name: str, format: str) -> datetime | None:
    """The QA clock header `name`, parsed with `format`; None when it is absent."""
    raw = request.headers.get(name)
    if not raw:
        return None
    try:
        return datetime.strptime(raw, format)
    except ValueError:
        raise _BadHeader(name) from None


def get_today(request: Request) -> date:
    """FastAPI dependency: today's business date."""
    if _QA_MODE:
        try:
            day = _header(request, "X-QA-Clock", _DAY)
        except _BadHeader as bad:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, f"bad {bad}") from None
        if day:
            return day.date()
    today: Callable[[], date] = request.app.state.today
    return today()


TodayDep = Annotated[date, Depends(get_today)]


def get_now(request: Request) -> datetime:
    """FastAPI dependency: the current local time, for audit entries; with only
    `X-QA-Clock`, noon on that day."""
    if _QA_MODE:
        try:
            now = _header(request, "X-QA-Clock-Now", _TIME)
            day = None if now else _header(request, "X-QA-Clock", _DAY)
        except _BadHeader as bad:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, f"bad {bad}") from None
        if now:
            return now
        if day:
            return day.replace(hour=12)
    clock: Callable[[], datetime] = request.app.state.now
    return clock()


NowDep = Annotated[datetime, Depends(get_now)]


# A calendar month as a query parameter, e.g. 2026-04.
MonthQuery = Annotated[str | None, Query(pattern=r"^\d{4}-(0[1-9]|1[0-2])$")]


def month_span(month: str) -> tuple[date, date]:
    """The first and last days of a YYYY-MM month."""
    first = date.fromisoformat(f"{month}-01")
    after = date(first.year + first.month // 12, first.month % 12 + 1, 1)
    return first, date.fromordinal(after.toordinal() - 1)
