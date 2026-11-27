"""The daily run: once-a-day jobs, started by the first API request of each day.

The app may run for weeks without restarting and has no scheduler, so the first
request on a new calendar day (in TZ) runs the jobs. A job is marked done, in the
database, only once it has succeeded: one that failed is tried again on a later request
the same day, and one that succeeded is not run again, even after a restart.

The day is the request's (see `platform/clock.py`): in QA mode `X-QA-Clock` sets it, and
the clock may move backwards, so each day that has been run is remembered, not only the
latest. The database keeps the latest day each job succeeded on.
"""

import logging
import threading
from collections.abc import Callable, Mapping
from datetime import date

from sqlalchemy.engine import Engine

from mortgage_backend.platform.db import get_config, set_config, write_transaction

log = logging.getLogger(__name__)

DailyJob = Callable[[date], None]


def _done_key(name: str) -> str:
    return f"daily_run_done_{name}"


class DailyRun:
    def __init__(self, engine: Engine, jobs: Mapping[str, DailyJob]) -> None:
        self.engine = engine
        self.jobs = dict(jobs)
        self.count = 0  # runs since the app started
        self._complete: set[date] = set()  # the days every job has succeeded on
        self._lock = threading.Lock()

    def run_if_due(self, today: date) -> None:
        """Run each job that has not succeeded on `today`. Jobs must return quickly."""
        if today in self._complete:
            return
        with self._lock:
            if today in self._complete:
                return
            with self.engine.connect() as conn:
                done = get_config(conn, [_done_key(name) for name in self.jobs])
            due = [
                name
                for name in self.jobs
                if done.get(_done_key(name)) != today.isoformat()
            ]
            if due:
                self.count += 1
            failed = False
            for name in due:
                try:
                    self.jobs[name](today)
                except Exception:
                    failed = True
                    log.exception("Daily job %s failed", name)
                    continue
                with write_transaction(self.engine) as conn:
                    set_config(conn, _done_key(name), today.isoformat())
            if not failed:
                self._complete.add(today)
