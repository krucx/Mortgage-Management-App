"""The daily run: each job is marked done only once it has succeeded."""

from datetime import date, timedelta

import pytest
from sqlalchemy import event

from mortgage_backend.platform.daily_run import DailyRun
from mortgage_backend.platform.db import make_engine, migrate

DAY = date(2026, 4, 20)


def today() -> date:
    return DAY


class Job:
    """A job that fails its first `failures` calls, then succeeds."""

    def __init__(self, failures: int = 0) -> None:
        self.failures = failures
        self.days: list[date] = []

    def __call__(self, day: date) -> None:
        self.days.append(day)
        if len(self.days) <= self.failures:
            raise RuntimeError("down")


@pytest.fixture
def engine(database_url):
    migrate(database_url)
    return make_engine(database_url)


def test_a_job_that_failed_is_retried_on_a_later_request_the_same_day(engine):
    flaky, steady = Job(failures=1), Job()
    run = DailyRun(engine, today, {"flaky": flaky, "steady": steady})

    run.run_if_due()
    run.run_if_due()
    run.run_if_due()

    assert (len(flaky.days), len(steady.days)) == (2, 1)


def test_a_job_that_succeeded_is_not_run_again_after_a_restart_the_same_day(engine):
    flaky, steady = Job(failures=1), Job()
    DailyRun(engine, today, {"flaky": flaky, "steady": steady}).run_if_due()

    DailyRun(engine, today, {"flaky": flaky, "steady": steady}).run_if_due()

    assert (len(flaky.days), len(steady.days)) == (2, 1)


def test_every_job_runs_again_on_the_next_day(engine):
    job = Job()
    current = [DAY]
    run = DailyRun(engine, lambda: current[0], {"job": job})
    run.run_if_due()

    current[0] = DAY + timedelta(days=1)
    run.run_if_due()

    assert job.days == [DAY, DAY + timedelta(days=1)]


def test_once_every_job_has_succeeded_a_request_does_not_touch_the_database(engine):
    run = DailyRun(engine, today, {"job": Job()})
    run.run_if_due()
    statements: list[str] = []
    event.listen(
        engine, "before_cursor_execute", lambda *args: statements.append(args[2])
    )

    run.run_if_due()

    assert statements == []
