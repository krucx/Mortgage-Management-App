"""Today's date, injectable so tests can pin it (business dates follow the TZ setting)."""

from collections.abc import Callable
from datetime import date, datetime
from typing import Annotated

from fastapi import Depends, Request


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
