"""The daily run: once-a-day jobs, started by the first API request of each day.

The app may run for weeks without restarting and has no scheduler, so the first
request on a new calendar day (in TZ) runs the jobs. The date of the last run is kept
in the database so a restart on the same day does not run them again.
"""

import logging
import threading
from collections.abc import Callable
from datetime import date

from sqlalchemy.engine import Engine

from mortgage_backend.db import get_config, set_config

log = logging.getLogger(__name__)

_LAST_RUN_KEY = "last_daily_run"

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
            last = get_config(conn, [_LAST_RUN_KEY]).get(_LAST_RUN_KEY)
            if last == today.isoformat():
                return
            set_config(conn, _LAST_RUN_KEY, today.isoformat())
            self.count += 1
        for job in self.jobs:
            try:
                job(today)
            except Exception:
                log.exception("Daily job %s failed", job)
