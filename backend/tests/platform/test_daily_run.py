"""The daily run: each job is marked done only once it has succeeded, for the day given."""

from datetime import date, timedelta

import pytest
from sqlalchemy import event

from mortgage_backend.platform.daily_run import DailyRun
from mortgage_backend.platform.db import make_engine, migrate

DAY = date(2026, 4, 20)


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
    run = DailyRun(engine, {"flaky": flaky, "steady": steady})

    run.run_if_due(DAY)
    run.run_if_due(DAY)
    run.run_if_due(DAY)

    assert (len(flaky.days), len(steady.days)) == (2, 1)


def test_a_job_that_succeeded_is_not_run_again_after_a_restart_the_same_day(engine):
    flaky, steady = Job(failures=1), Job()
    DailyRun(engine, {"flaky": flaky, "steady": steady}).run_if_due(DAY)

    DailyRun(engine, {"flaky": flaky, "steady": steady}).run_if_due(DAY)

    assert (len(flaky.days), len(steady.days)) == (2, 1)


def test_every_job_runs_again_on_the_next_day(engine):
    job = Job()
    run = DailyRun(engine, {"job": job})
    run.run_if_due(DAY)

    run.run_if_due(DAY + timedelta(days=1))

    assert job.days == [DAY, DAY + timedelta(days=1)]


def test_once_every_job_has_succeeded_a_request_does_not_touch_the_database(engine):
    run = DailyRun(engine, {"job": Job()})
    run.run_if_due(DAY)
    statements: list[str] = []
    event.listen(
        engine, "before_cursor_execute", lambda *args: statements.append(args[2])
    )

    run.run_if_due(DAY)

    assert statements == []


def test_a_day_earlier_than_one_already_run_still_runs(engine):
    """In QA mode the clock can move backwards; each day is run once."""
    job = Job()
    run = DailyRun(engine, {"job": job})
    later, earlier = DAY + timedelta(days=10), DAY

    for day in (later, earlier, later, earlier):
        run.run_if_due(day)

    assert job.days == [later, earlier]
