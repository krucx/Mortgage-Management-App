"""The daily run and Backups: zips of the database and photos in the backup folder."""

import io
import sqlite3
import zipfile
from datetime import datetime, timedelta

import pytest
from alembic import command
from alembic.config import Config
from api_seed import person
from fastapi.testclient import TestClient
from PIL import Image

from mortgage_backend.main import create_app
from mortgage_backend.platform.db import MIGRATIONS_DIR

PASSWORD = "open sesame"


class Clock:
    def __init__(self) -> None:
        self.now = datetime(2026, 4, 20, 10, 30)

    def days_later(self, days: int) -> None:
        self.now += timedelta(days=days)


@pytest.fixture
def clock():
    return Clock()


@pytest.fixture
def backup_dir(tmp_path):
    return tmp_path / "backups"


def start(database_url, clock, backup_dir, password=PASSWORD):
    return TestClient(
        create_app(
            database_url,
            today=lambda: clock.now.date(),
            now=lambda: clock.now,
            backup_dir=backup_dir,
            backup_password=password,
        )
    )


@pytest.fixture
def client(database_url, clock, backup_dir):
    with start(database_url, clock, backup_dir) as client:
        yield client


def finished(client):
    """Make a request (so today's daily run happens), wait for any Backup running in
    the background, then return the status."""
    client.get("/api/backups")
    client.app.state.backups.wait()
    return client.get("/api/backups").json()


def backups_in(backup_dir):
    return sorted(path.name for path in backup_dir.glob("*.zip"))


def add_customer_with_photo(client):
    jpeg = io.BytesIO()
    Image.new("RGB", (20, 20), "gold").save(jpeg, "JPEG")
    customer = person(client)
    client.put(
        f"/api/customers/{customer['id']}/photo",
        files={"photo": ("photo.jpg", jpeg.getvalue(), "image/jpeg")},
    )


def test_the_first_request_of_the_day_starts_a_backup(client, backup_dir):
    client.get("/api/settings/default-terms")
    finished(client)

    assert backups_in(backup_dir) == ["mortgage-backup-2026-04-20-1030.zip"]


def test_a_backup_holds_the_database_and_photos(client, clock, backup_dir, tmp_path):
    add_customer_with_photo(client)
    finished(client)
    clock.now += timedelta(minutes=1)

    client.post("/api/backups")
    finished(client)

    name = backups_in(backup_dir)[-1]
    with zipfile.ZipFile(backup_dir / name) as backup:
        backup.setpassword(PASSWORD.encode())
        assert any(
            n.startswith("photos/") and n.endswith(".jpg") for n in backup.namelist()
        )
        backup.extract("mortgage.db", tmp_path / "restored")
    restored = sqlite3.connect(tmp_path / "restored" / "mortgage.db")
    assert restored.execute("select name from customer").fetchall() == [
        ("Ramesh Kumar",)
    ]
    restored.close()


def test_a_backup_cannot_be_read_without_the_password(client, backup_dir):
    finished(client)

    [name] = backups_in(backup_dir)
    with (
        zipfile.ZipFile(backup_dir / name) as backup,
        pytest.raises(RuntimeError, match="password"),
    ):
        backup.read("mortgage.db")


def test_without_a_password_backups_are_plain_zips(database_url, clock, backup_dir):
    with start(database_url, clock, backup_dir, password="") as client:
        status = finished(client)

    assert status["encrypted"] is False
    [name] = backups_in(backup_dir)
    with zipfile.ZipFile(backup_dir / name) as backup:
        assert backup.read("mortgage.db")[:15] == b"SQLite format 3"


def test_the_daily_run_backs_up_only_when_the_last_backup_is_a_week_old(
    client, clock, backup_dir
):
    finished(client)
    client.get("/api/settings/default-terms")  # same day: the daily run is done
    for _ in range(6):
        clock.days_later(1)
        finished(client)
    assert len(backups_in(backup_dir)) == 1

    clock.days_later(1)  # 7 days since the last Backup
    finished(client)

    assert backups_in(backup_dir)[-1] == "mortgage-backup-2026-04-27-1030.zip"
    assert len(backups_in(backup_dir)) == 2


def test_the_daily_run_happens_once_a_day(client, clock):
    finished(client)
    first = client.app.state.daily_run.count
    client.get("/api/settings/default-terms")
    finished(client)

    assert client.app.state.daily_run.count == first
    clock.days_later(1)
    finished(client)
    assert client.app.state.daily_run.count == first + 1


def test_backing_up_now_shows_when_it_was_taken(client, clock):
    finished(client)
    clock.now += timedelta(hours=2)

    response = client.post("/api/backups")

    assert response.status_code == 202, response.text
    status = finished(client)
    assert status["last_backup_at"] == "2026-04-20T12:30:00"
    assert status["last_backup_file"] == "mortgage-backup-2026-04-20-1230.zip"
    assert status["running"] is False
    assert status["last_error"] is None
    assert status["encrypted"] is True


def test_only_the_last_few_backups_are_kept(client, clock, backup_dir):
    assert finished(client)["keep"] == 4
    for _ in range(5):
        clock.days_later(7)
        finished(client)

    assert backups_in(backup_dir) == [
        "mortgage-backup-2026-05-04-1030.zip",
        "mortgage-backup-2026-05-11-1030.zip",
        "mortgage-backup-2026-05-18-1030.zip",
        "mortgage-backup-2026-05-25-1030.zip",
    ]


def test_how_many_backups_to_keep_is_a_setting(client, clock, backup_dir):
    finished(client)
    response = client.put("/api/settings/backups", json={"keep": 2})
    assert response.status_code == 200, response.text
    for _ in range(3):
        clock.days_later(7)
        finished(client)

    assert len(backups_in(backup_dir)) == 2


def test_keeping_fewer_backups_removes_the_oldest_at_once(client, clock, backup_dir):
    for _ in range(3):
        clock.days_later(7)
        finished(client)

    client.put("/api/settings/backups", json={"keep": 1})

    # Not a week later at the next Backup: straight away.
    assert backups_in(backup_dir) == ["mortgage-backup-2026-05-11-1030.zip"]


def test_other_files_in_the_backup_folder_are_left_alone(client, clock, backup_dir):
    backup_dir.mkdir()
    (backup_dir / "notes.txt").write_text("mine")
    client.put("/api/settings/backups", json={"keep": 1})
    for _ in range(2):
        clock.days_later(7)
        finished(client)

    assert (backup_dir / "notes.txt").exists()


def test_an_interrupted_backup_is_cleaned_up_on_start(database_url, clock, backup_dir):
    backup_dir.mkdir()
    half_written = backup_dir / ".mortgage-backup-2026-04-19-2200.zip.partial"
    half_written.write_bytes(b"PK")

    with start(database_url, clock, backup_dir):
        pass

    assert not half_written.exists()


def test_an_update_backs_up_the_database_before_migrating_it(
    database_url, clock, backup_dir
):
    old = Config()
    old.set_main_option("script_location", str(MIGRATIONS_DIR))
    old.set_main_option("sqlalchemy.url", database_url)
    command.upgrade(old, "0007")  # the database from the previous version of the app

    with start(database_url, clock, backup_dir):
        pass

    assert backups_in(backup_dir) == [
        "mortgage-backup-2026-04-20-1030-before-update.zip"
    ]


def test_a_fresh_install_takes_no_backup_before_update(database_url, clock, backup_dir):
    with start(database_url, clock, backup_dir) as client:
        client.app.state.backups.wait()

    assert backups_in(backup_dir) == ["mortgage-backup-2026-04-20-1030.zip"]


def test_a_weekly_backup_that_did_not_finish_is_retried_on_the_next_start(
    database_url, clock, backup_dir, tmp_path
):
    with start(database_url, clock, backup_dir) as client:
        finished(client)
    clock.days_later(7)
    unusable = tmp_path / "unusable"
    unusable.write_text("not a folder")
    with start(database_url, clock, unusable) as client:
        assert finished(client)["last_error"]  # today's daily run is used up

    with start(database_url, clock, backup_dir) as client:
        client.app.state.backups.wait()  # no request needed

    assert backups_in(backup_dir)[-1] == "mortgage-backup-2026-04-27-1030.zip"


def test_two_backups_in_the_same_minute_are_both_kept(client, backup_dir):
    finished(client)

    client.post("/api/backups")
    finished(client)

    assert backups_in(backup_dir) == [
        "mortgage-backup-2026-04-20-1030-2.zip",
        "mortgage-backup-2026-04-20-1030.zip",
    ]


def test_without_the_zip_program_backups_are_plain_zips_made_by_the_app(
    database_url, clock, backup_dir, tmp_path, monkeypatch
):
    # As on Windows without Docker: no zip program to be found.
    monkeypatch.setenv("PATH", str(tmp_path / "nothing-here"))
    with start(database_url, clock, backup_dir, password="") as client:
        add_customer_with_photo(client)
        finished(client)  # the day's first Backup, started by the first request
        clock.now += timedelta(minutes=1)
        client.post("/api/backups")
        status = finished(client)

    assert status["last_error"] is None
    name = backups_in(backup_dir)[-1]
    with zipfile.ZipFile(backup_dir / name) as backup:
        assert backup.read("mortgage.db")[:15] == b"SQLite format 3"
        assert any(
            n.startswith("photos/") and n.endswith(".jpg") for n in backup.namelist()
        )


def test_a_backup_password_needs_the_zip_program(
    database_url, clock, backup_dir, tmp_path, monkeypatch
):
    monkeypatch.setenv("PATH", str(tmp_path / "nothing-here"))
    with start(database_url, clock, backup_dir) as client:
        status = finished(client)

    # Never quietly unprotected: the Backup fails, and says why.
    assert "zip program" in status["last_error"]
    assert backups_in(backup_dir) == []


def test_a_failed_backup_is_reported_and_leaves_nothing_behind(
    database_url, clock, tmp_path
):
    not_a_folder = tmp_path / "backups"
    not_a_folder.write_text("a file where the backup folder should be")

    with start(database_url, clock, not_a_folder) as client:
        status = finished(client)

    assert status["last_error"]
    assert status["last_backup_at"] is None
    assert not (tmp_path / ".backup-work").exists()
