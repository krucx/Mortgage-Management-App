"""Today's date, injectable so tests can pin it (business dates follow the TZ setting).

In QA mode (`QA_MODE=true`, fixed at process start) the request headers
`X-QA-Clock` (`YYYY-MM-DD`) and optional `X-QA-Clock-Now` (`YYYY-MM-DDTHH:MM:SS`)
override the process clock for that request only: stateless and race-free. Outside
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


def _parse_date(raw: str, header: str) -> date:
    try:
        return datetime.strptime(raw, "%Y-%m-%d").date()
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"bad {header}",
        ) from None


def _parse_datetime(raw: str, header: str) -> datetime:
    try:
        return datetime.strptime(raw, "%Y-%m-%dT%H:%M:%S")
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"bad {header}",
        ) from None


def get_today(request: Request) -> date:
    """FastAPI dependency: today's business date."""
    if _QA_MODE:
        raw = request.headers.get("X-QA-Clock")
        if raw:
            return _parse_date(raw, "X-QA-Clock")
    today: Callable[[], date] = request.app.state.today
    return today()


TodayDep = Annotated[date, Depends(get_today)]


def get_now(request: Request) -> datetime:
    """FastAPI dependency: the current local time, for audit entries."""
    if _QA_MODE:
        raw = request.headers.get("X-QA-Clock-Now")
        if raw:
            return _parse_datetime(raw, "X-QA-Clock-Now")
        day = request.headers.get("X-QA-Clock")
        if day:
            parsed = _parse_date(day, "X-QA-Clock")
            return datetime(parsed.year, parsed.month, parsed.day, 12, 0, 0)
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
