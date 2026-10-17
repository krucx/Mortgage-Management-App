"""Backups: password-protected zips of the database and photos (ADR 0003).

A Backup is written in a scratch folder, copied into the backup folder under a hidden
`.partial` name and only then renamed, so a half-written zip never looks like a Backup.
Anything left behind by an interrupted Backup is removed before the next one starts.
"""

import logging
import os
import re
import shutil
import sqlite3
import subprocess
import threading
from collections.abc import Callable
from datetime import date, datetime
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field
from sqlalchemy.engine import Engine

from mortgage_backend.db import database_file, get_config, photos_dir, set_config

log = logging.getLogger(__name__)

DAYS_BETWEEN_BACKUPS = 7
DEFAULT_KEEP = 4
_BACKUP_NAME = re.compile(
    r"^mortgage-backup-\d{4}-\d{2}-\d{2}-\d{4}(-[a-z0-9-]+)?\.zip$"
)
_KEYS = {
    "keep": "backup_keep",
    "last_at": "backup_last_at",
    "last_file": "backup_last_file",
    "last_error": "backup_last_error",
}


def backup_dir_from_env() -> Path:
    return Path(os.environ.get("BACKUP_DIR", "backups"))


def backup_password_from_env() -> str:
    return os.environ.get("BACKUP_PASSWORD", "")


class BackupStatus(BaseModel):
    enabled: bool  # False when no backup folder is configured
    encrypted: bool  # False when no password is set
    running: bool
    last_backup_at: datetime | None
    last_backup_file: str | None
    last_error: str | None  # from the latest attempt, if it failed
    keep: int


class BackupSettings(BaseModel):
    keep: int = Field(ge=1)  # how many Backups to keep


class Backups:
    def __init__(
        self,
        engine: Engine,
        database_url: str,
        backup_dir: Path | None,
        password: str,
        now: Callable[[], datetime],
    ) -> None:
        self.engine = engine
        self.database = database_file(database_url)
        self.photos = photos_dir(database_url)
        self.work_dir = self.database.parent / ".backup-work"
        self.backup_dir = backup_dir
        self.password = password
        self.now = now
        self._lock = threading.Lock()
        self._thread: threading.Thread | None = None

    def _config(self) -> dict[str, str]:
        with self.engine.connect() as conn:
            return get_config(conn, _KEYS.values())

    def _record(self, **values: str) -> None:
        with self.engine.begin() as conn:
            for field, value in values.items():
                set_config(conn, _KEYS[field], value)

    def keep(self) -> int:
        return self.status().keep

    def set_keep(self, keep: int) -> None:
        self._record(keep=str(keep))

    def status(self) -> BackupStatus:
        config = self._config()
        last_at = config.get(_KEYS["last_at"])
        return BackupStatus(
            enabled=self.backup_dir is not None,
            encrypted=bool(self.password),
            running=self.running,
            last_backup_at=datetime.fromisoformat(last_at) if last_at else None,
            last_backup_file=config.get(_KEYS["last_file"]),
            last_error=config.get(_KEYS["last_error"]) or None,
            keep=int(config.get(_KEYS["keep"], DEFAULT_KEEP)),
        )

    @property
    def running(self) -> bool:
        return self._thread is not None and self._thread.is_alive()

    def clean_leftovers(self) -> None:
        """Remove what an interrupted Backup left behind."""
        shutil.rmtree(self.work_dir, ignore_errors=True)
        if self.backup_dir is not None and self.backup_dir.is_dir():
            for partial in self.backup_dir.glob(".mortgage-backup-*.partial"):
                partial.unlink(missing_ok=True)

    def make(self, label: str = "") -> Path:
        """Write a Backup now, record it and prune old ones. Raises if it fails."""
        if self.backup_dir is None:
            raise RuntimeError("No backup folder is configured")
        taken_at = self.now().replace(second=0, microsecond=0)
        self.clean_leftovers()
        try:
            self.work_dir.mkdir(parents=True)
            self._snapshot_database(self.work_dir / "mortgage.db")
            archive = self.work_dir / "backup.zip"
            self._zip(archive, "mortgage.db", cwd=self.work_dir)
            if self.photos.is_dir():
                self._zip(archive, self.photos.name, cwd=self.photos.parent)
            self.backup_dir.mkdir(parents=True, exist_ok=True)
            name = self._unused_name(taken_at, label)
            partial = self.backup_dir / f".{name}.partial"
            shutil.copyfile(self.work_dir / "backup.zip", partial)
            os.replace(partial, self.backup_dir / name)
        finally:
            self.clean_leftovers()
        self._record(last_at=taken_at.isoformat(), last_file=name, last_error="")
        self._prune()
        return self.backup_dir / name

    def _snapshot_database(self, target: Path) -> None:
        """A consistent copy of the database, safe while the app keeps writing."""
        source = sqlite3.connect(self.database)
        copy = sqlite3.connect(target)
        try:
            source.backup(copy)
        finally:
            copy.close()
            source.close()

    def _unused_name(self, taken_at: datetime, label: str) -> str:
        """mortgage-backup-<date>-<time>[-label].zip, numbered if that minute is taken."""
        assert self.backup_dir is not None
        stem = f"mortgage-backup-{taken_at:%Y-%m-%d-%H%M}{f'-{label}' if label else ''}"
        name, n = f"{stem}.zip", 1
        while (self.backup_dir / name).exists():
            n += 1
            name = f"{stem}-{n}.zip"
        return name

    def _zip(self, archive: Path, path: str, cwd: Path) -> None:
        """Add `path` (under `cwd`) to a standard password zip, which opens in Explorer
        and Finder. Info-ZIP takes the password only as an argument; that is visible
        to other processes in the container, and kept out of any error message."""
        password = ["-P", self.password] if self.password else []
        result = subprocess.run(
            ["zip", "-q", "-r", "-X", *password, str(archive), path],
            cwd=cwd,
            capture_output=True,
            text=True,
            check=False,  # reported below without the arguments (the password)
        )
        if result.returncode != 0:
            raise RuntimeError(
                f"zip failed: {result.stderr.strip() or result.returncode}"
            )

    def _prune(self) -> None:
        assert self.backup_dir is not None
        backups = sorted(
            p for p in self.backup_dir.iterdir() if _BACKUP_NAME.match(p.name)
        )
        for old in backups[: -self.keep()]:
            old.unlink(missing_ok=True)

    def start(self) -> bool:
        """Back up in the background; False if a Backup is already running."""
        with self._lock:
            if self.running or self.backup_dir is None:
                return False
            self._thread = threading.Thread(
                target=self._run, name="backup", daemon=True
            )
            self._thread.start()
            return True

    def _run(self) -> None:
        try:
            self.make()
        except Exception as error:
            log.exception("Backup failed")
            self._record(last_error=str(error) or type(error).__name__)

    def start_if_due(self, today: date) -> None:
        """The daily-run job: back up when the last Backup is a week old or more."""
        last_at = self.status().last_backup_at
        if last_at is None or (today - last_at.date()).days >= DAYS_BETWEEN_BACKUPS:
            self.start()

    def wait(self, timeout: float | None = None) -> None:
        thread = self._thread
        if thread is not None:
            thread.join(timeout)


def get_backups(request: Request) -> Backups:
    backups: Backups = request.app.state.backups
    return backups


BackupsDep = Annotated[Backups, Depends(get_backups)]

router = APIRouter(prefix="/api")


@router.get("/backups")
def read_backup_status(backups: BackupsDep) -> BackupStatus:
    return backups.status()


@router.post("/backups", status_code=status.HTTP_202_ACCEPTED)
def back_up_now(backups: BackupsDep) -> BackupStatus:
    """Start a Backup in the background; poll GET /backups for the result."""
    if backups.backup_dir is None:
        raise HTTPException(status.HTTP_409_CONFLICT, "No backup folder is configured")
    if not backups.start():
        raise HTTPException(status.HTTP_409_CONFLICT, "A Backup is already running")
    return backups.status()


@router.put("/settings/backups")
def update_backup_settings(
    settings: BackupSettings, backups: BackupsDep
) -> BackupStatus:
    backups.set_keep(settings.keep)
    return backups.status()
