"""Whether a newer release of the app is out, for the in-app update banner: GitHub's latest
release, asked at most once a day, and quietly nothing when it can't be reached. Only an
installed app asks (CHECK_FOR_UPDATES, set by docker-compose.yml and windows/run.ps1), so a
development build never does."""

import json
import os
import re
import threading
import urllib.request
from collections.abc import Callable
from datetime import datetime, timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel

LATEST_RELEASE_URL = "https://api.github.com/repos/krucx/Mortgage-Management-App/releases/latest"
ASK_EVERY = timedelta(days=1)
VERSION = re.compile(r"^\d+\.\d+\.\d+$")


class Release(BaseModel):
    version: str
    notes: str  # its CHANGELOG section, as Markdown


# Where to ask for the latest release; nowhere (None) for a development build.
LatestRelease = Callable[[], Release | None]


class UpdateStatus(BaseModel):
    running: str  # the version of this backend
    available: Release | None  # a newer release, if there is one


def latest_release_from_github() -> Release | None:
    """GitHub's latest release of the app, given a few seconds to answer."""
    request = urllib.request.Request(
        LATEST_RELEASE_URL,
        headers={"Accept": "application/vnd.github+json", "User-Agent": "mortgage-management"},
    )
    with urllib.request.urlopen(request, timeout=5) as response:
        release = json.load(response)
    tag = str(release.get("tag_name", ""))
    return Release(version=tag, notes=str(release.get("body") or "")) if VERSION.match(tag) else None


def latest_release_from_env() -> LatestRelease | None:
    """Where to ask for the latest release: GitHub when CHECK_FOR_UPDATES is true, else nowhere."""
    return latest_release_from_github if os.environ.get("CHECK_FOR_UPDATES") == "true" else None


def _newer(version: str, than: str) -> bool:
    if not (VERSION.match(version) and VERSION.match(than)):
        return False
    return tuple(map(int, version.split("."))) > tuple(map(int, than.split(".")))


class UpdateCheck:
    """The newest release, as last asked of `latest_release` (never, without one)."""

    def __init__(
        self,
        running: str,
        latest_release: LatestRelease | None,
        now: Callable[[], datetime],
    ) -> None:
        self.running = running
        self._latest_release = latest_release
        self._now = now
        self._lock = threading.Lock()
        self._asked_at: datetime | None = None
        self._latest: Release | None = None

    def status(self) -> UpdateStatus:
        with self._lock:
            now = self._now()
            if self._latest_release is not None and (
                self._asked_at is None or now - self._asked_at >= ASK_EVERY
            ):
                self._asked_at = now
                try:
                    self._latest = self._latest_release()
                except Exception:
                    self._latest = None  # offline, or GitHub didn't answer: no banner
            latest = self._latest
        available = latest if latest is not None and _newer(latest.version, self.running) else None
        return UpdateStatus(running=self.running, available=available)


def get_update_check(request: Request) -> UpdateCheck:
    update_check: UpdateCheck = request.app.state.update_check
    return update_check


UpdateCheckDep = Annotated[UpdateCheck, Depends(get_update_check)]

router = APIRouter(prefix="/api")


@router.get("/update")
def read_update_status(update_check: UpdateCheckDep) -> UpdateStatus:
    return update_check.status()
