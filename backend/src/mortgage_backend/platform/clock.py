"""Today's date, injectable so tests can pin it (business dates follow the TZ setting).

In QA mode (`QA_MODE=true`) the request headers `X-QA-Clock` (`YYYY-MM-DD`) and
optional `X-QA-Clock-Now` (`YYYY-MM-DDTHH:MM:SS`) override the process clock for
that request only: stateless and race-free. Outside QA mode, or when the headers
are absent, the injectable `app.state.today` / `.now` callables are used, so
unit tests that pin `create_app(today=…)` are unaffected.
"""

from collections.abc import Callable
from datetime import date, datetime
from typing import Annotated

from fastapi import Depends, HTTPException, Query, Request, status


def _qa_mode() -> bool:
    import os

    return os.getenv("QA_MODE") == "true"


def get_today(request: Request) -> date:
    """FastAPI dependency: today's business date."""
    if _qa_mode():
        raw = request.headers.get("X-QA-Clock")
        if raw:
            try:
                return date.fromisoformat(raw)
            except ValueError:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="bad X-QA-Clock",
                ) from None
    today: Callable[[], date] = request.app.state.today
    return today()


TodayDep = Annotated[date, Depends(get_today)]


def get_now(request: Request) -> datetime:
    """FastAPI dependency: the current local time, for audit entries."""
    if _qa_mode():
        raw = request.headers.get("X-QA-Clock-Now")
        if raw:
            try:
                return datetime.fromisoformat(raw)
            except ValueError:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="bad X-QA-Clock-Now",
                ) from None
        day = request.headers.get("X-QA-Clock")
        if day:
            try:
                return datetime.fromisoformat(f"{day}T12:00:00")
            except ValueError:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="bad X-QA-Clock",
                ) from None
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
