"""The daily run: once-a-day jobs, started by the first API request of each day.

The app may run for weeks without restarting and has no scheduler, so the first
request on a new calendar day (in TZ) runs the jobs. The date of the last run is kept
in the database so a restart on the same day does not run them again.
"""

import logging
import threading
from collections.abc import Callable
from datetime import date

from pydantic import BaseModel
from sqlalchemy.engine import Engine

from mortgage_backend.platform.settings import ConfigGroup

log = logging.getLogger(__name__)


class _LastRun(BaseModel):
    ran_on: date | None = None


_LAST_RUN = ConfigGroup(_LastRun, {"ran_on": "last_daily_run"})

DailyJob = Callable[[date], None]


class DailyRun:
    def __init__(
        self, engine: Engine, today: Callable[[], date], jobs: list[DailyJob]
    ) -> None:
        self.engine = engine
        self.today = today
        self.jobs = jobs
        self.count = 0  # runs since the app started
        self._lock = threading.Lock()

    def run_if_due(self) -> None:
        """Run every job once if they have not run today. Jobs must return quickly."""
        today = self.today()
        with self._lock, self.engine.begin() as conn:
            if _LAST_RUN.get(conn).ran_on == today:
                return
            _LAST_RUN.set(conn, _LastRun(ran_on=today), today)
            self.count += 1
        for job in self.jobs:
            try:
                job(today)
            except Exception:
                log.exception("Daily job %s failed", job)
