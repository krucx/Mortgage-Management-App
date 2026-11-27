"""Every write takes the database's write lock (#602): `write_transaction` is the only
way the backend writes, so writers that overlap queue behind each other instead of
racing, and this one test at that seam covers every route."""

import re
import threading
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

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
