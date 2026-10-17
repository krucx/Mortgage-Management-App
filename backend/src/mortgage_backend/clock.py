"""Today's date, injectable so tests can pin it (business dates follow the TZ setting)."""

from collections.abc import Callable
from datetime import date
from typing import Annotated

from fastapi import Depends, Request


def get_today(request: Request) -> date:
    """FastAPI dependency: today's business date."""
    today: Callable[[], date] = request.app.state.today
    return today()


TodayDep = Annotated[date, Depends(get_today)]
