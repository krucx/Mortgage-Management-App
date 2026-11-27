"""Every write takes the database's write lock (#602): `write_transaction` is the only
way the backend writes, so writers that overlap queue behind each other instead of
racing, and this one test at that seam covers every route."""

import asyncio
import io
import re
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import httpx2
import pytest
from conftest import TODAY
from PIL import Image

from mortgage_backend.main import create_app
from mortgage_backend.platform.db import (
    get_config,
    make_engine,
    migrate,
    set_config,
    write_transaction,
)

SOURCE = Path(__file__).parents[2] / "src" / "mortgage_backend"
DATABASE_MODULE = SOURCE / "platform" / "db.py"

# How long the first writer waits, after reading, for the other to read too: it never
# can while the first holds the lock, so the wait just runs out.
PAUSE = 1.0


def test_two_writers_that_read_then_write_on_what_they_read_lose_no_update(
    database_url: str,
) -> None:
    migrate(database_url)
    engine = make_engine(database_url)
    with write_transaction(engine) as conn:
        set_config(conn, "counter", "0")
    first_read, second_read = threading.Event(), threading.Event()

    def add_one(read: threading.Event, then_wait_for: threading.Event | None) -> None:
        with write_transaction(engine) as conn:
            counter = int(get_config(conn, ["counter"])["counter"])
            read.set()
            if then_wait_for is not None:
                then_wait_for.wait(PAUSE)
            set_config(conn, "counter", str(counter + 1))

    with ThreadPoolExecutor() as pool:
        first = pool.submit(add_one, first_read, second_read)
        assert first_read.wait(5)
        second = pool.submit(add_one, second_read, None)
        first.result(), second.result()

    with engine.connect() as conn:
        assert get_config(conn, ["counter"]) == {"counter": "2"}


def test_only_the_database_module_opens_a_transaction() -> None:
    """A new `.begin()`, or a `.commit()` on a plain connection, would be an ordinary
    transaction, which loses an update when another writer commits between its read
    and its write: use `write_transaction`."""
    opening = re.compile(r"\.(begin|commit)\(")
    found = [
        f"{path.relative_to(SOURCE)}:{number}"
        for path in sorted(SOURCE.rglob("*.py"))
        if path != DATABASE_MODULE
        for number, line in enumerate(path.read_text().splitlines(), start=1)
        if opening.search(line)
    ]

    assert found == []


_PNG = io.BytesIO()
Image.new("RGB", (4, 4)).save(_PNG, "PNG")
PNG = (
    _PNG.getvalue()
)  # also what the import route gets: a refusal, once it has the lock

UPLOAD_ROUTES = [
    ("POST", "/api/call-list/import", "file"),
    ("PUT", "/api/customers/1/photo", "photo"),
    ("PUT", "/api/customers/1/id-photos/pan", "photo"),
    ("POST", "/api/mortgages/1/photos", "photo"),
]


@pytest.mark.parametrize(("method", "path", "field"), UPLOAD_ROUTES)
def test_an_upload_waiting_for_the_write_lock_does_not_stall_other_requests(
    database_url: str, method: str, path: str, field: str
) -> None:
    """The wait runs in a worker thread, not on the event loop every request shares."""

    async def scenario() -> float:
        """How long the event loop took to wake from a half-second sleep while the upload
        waited for the lock."""
        app = create_app(database_url, today=lambda: TODAY)
        async with app.router.lifespan_context(app):
            holder = make_engine(database_url)
            async with httpx2.AsyncClient(
                transport=httpx2.ASGITransport(app=app), base_url="http://localhost"
            ) as client:
                await client.get("/api/customers")  # today's daily jobs run now
                with write_transaction(holder):
                    upload = asyncio.create_task(
                        client.request(method, path, files={field: ("f", PNG)})
                    )
                    started = time.monotonic()
                    await asyncio.sleep(0.5)  # the upload reaches the lock meanwhile
                    woke_after = time.monotonic() - started
                await upload
                return woke_after

    assert asyncio.run(scenario()) < 2.0
