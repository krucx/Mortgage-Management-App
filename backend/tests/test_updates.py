"""Whether a newer release is out: asked of GitHub at most once a day, and quietly nothing
when it can't be reached."""

from datetime import datetime, timedelta
from importlib.metadata import version

import pytest
from conftest import TODAY
from fastapi.testclient import TestClient

from mortgage_backend.main import create_app
from mortgage_backend.platform.updates import Release

RUNNING = version("mortgage-backend")


def bumped(by: int) -> str:
    """The running version with its patch number moved by `by`."""
    major, minor, patch = (int(part) for part in RUNNING.split("."))
    return f"{major}.{minor}.{patch + by}"


class GitHub:
    """Stands in for GitHub's latest release, counting how often it is asked."""

    def __init__(self, latest: Release | None = None, offline: bool = False) -> None:
        self.latest = latest
        self.offline = offline
        self.asked = 0

    def __call__(self) -> Release | None:
        self.asked += 1
        if self.offline:
            raise TimeoutError("timed out")
        return self.latest


class Clock:
    def __init__(self) -> None:
        self.now = datetime(2026, 10, 30, 9, 0)

    def __call__(self) -> datetime:
        return self.now


@pytest.fixture
def clock():
    return Clock()


def start(database_url, github, clock):
    return TestClient(
        create_app(database_url, today=lambda: TODAY, now=clock, latest_release=github)
    )


def test_a_newer_release_is_offered_with_its_notes(database_url, clock):
    github = GitHub(Release(version=bumped(1), notes="### Added\n\n- Safe updates."))
    with start(database_url, github, clock) as client:
        answer = client.get("/api/update").json()

    assert answer == {
        "running": RUNNING,
        "available": {"version": bumped(1), "notes": "### Added\n\n- Safe updates."},
    }


@pytest.mark.parametrize("by", [0, -1])
def test_nothing_is_offered_when_the_running_version_is_the_newest(database_url, clock, by):
    with start(database_url, GitHub(Release(version=bumped(by), notes="")), clock) as client:
        assert client.get("/api/update").json() == {"running": RUNNING, "available": None}


def test_nothing_is_offered_and_nothing_fails_when_github_cannot_be_reached(database_url, clock):
    with start(database_url, GitHub(offline=True), clock) as client:
        response = client.get("/api/update")

    assert response.status_code == 200
    assert response.json() == {"running": RUNNING, "available": None}


def test_github_is_asked_at_most_once_a_day(database_url, clock):
    github = GitHub(Release(version=bumped(1), notes=""))
    with start(database_url, github, clock) as client:
        client.get("/api/update")
        clock.now += timedelta(hours=23)
        client.get("/api/update")
        assert github.asked == 1

        clock.now += timedelta(hours=1)
        client.get("/api/update")
        assert github.asked == 2


def test_a_development_build_never_asks(database_url):
    with TestClient(create_app(database_url, today=lambda: TODAY)) as client:
        assert client.get("/api/update").json() == {"running": RUNNING, "available": None}
