"""Reminders under overlapping requests (#515): reading them syncs the queue, so reads
on different dates, and reads alongside other changes, must not undo or break each
other. The Mortgage is ₹1,00,000 from 14 Jan 2026, so it accrues on 14 May.
"""

import threading
from collections.abc import Callable, Iterator
from concurrent.futures import ThreadPoolExecutor
from datetime import date
from typing import Any

import pytest
from api_seed import lend, person
from fastapi.testclient import TestClient

from mortgage_backend.follow_up import reminders
from mortgage_backend.main import create_app

# How long a paused request waits for the other to act; once requests no longer
# overlap, the other one waits for it instead, and the pause just runs out.
PAUSE = 1.0


class Clock:
    def __init__(self, today: date) -> None:
        self.today = today


@pytest.fixture
def clock() -> Clock:
    return Clock(date(2026, 5, 12))


@pytest.fixture
def app_client(database_url: str, clock: Clock) -> Iterator[TestClient]:
    with TestClient(create_app(database_url, today=lambda: clock.today)) as client:
        yield client


class Pause:
    """Holds the first request that calls `name` in the reminders module, just after
    it returns, until `resume` (or PAUSE runs out), so another request can run then."""

    def __init__(self, monkeypatch: pytest.MonkeyPatch, name: str) -> None:
        self.reached = threading.Event()
        self.resumed = threading.Event()
        original: Callable[..., Any] = getattr(reminders, name)

        def paused(*args: Any, **kwargs: Any) -> Any:
            result = original(*args, **kwargs)
            if not self.reached.is_set():
                self.reached.set()
                self.resumed.wait(PAUSE)
            return result

        monkeypatch.setattr(reminders, name, paused)

    def resume(self) -> None:
        self.resumed.set()


def to_send(client: TestClient) -> list[Any]:
    response = client.get("/api/reminders", params={"status": "queued"})
    assert response.status_code == 200, response.text
    return response.json()["items"]


def test_a_read_overlapping_a_new_mortgage_still_answers(
    app_client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    ramesh = person(app_client)
    lend(app_client, ramesh)
    pause = Pause(monkeypatch, "active_replays")

    with ThreadPoolExecutor() as pool:
        read = pool.submit(to_send, app_client)
        assert pause.reached.wait(5)
        lend(app_client, ramesh, description="Gold ring")
        pause.resume()
        queued = read.result()

    assert [r["customer"]["name"] for r in queued] == ["Ramesh Kumar"]
    [reminder] = to_send(app_client)
    assert [m["name"] for m in reminder["mortgages"]] == [
        "2026-Ramesh-GoldChain",
        "2026-Ramesh-GoldRing",
    ]


def test_a_reminder_withdrawn_while_it_is_sent_is_sent_first(
    app_client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    chain = lend(app_client, person(app_client))
    [reminder] = to_send(app_client)
    pause = Pause(monkeypatch, "list_reminders")

    with ThreadPoolExecutor() as pool:
        sending = pool.submit(app_client.post, f"/api/reminders/{reminder['id']}/sent")
        assert pause.reached.wait(5)
        # While it is sent, the Mortgage is redeemed and a read withdraws its Reminder.
        redeemed = app_client.post(
            f"/api/mortgages/{chain['id']}/redeem",
            json={"redeemed_on": "2026-05-12", "method": "cash"},
        )
        assert redeemed.status_code == 200, redeemed.text
        to_send(app_client)
        pause.resume()
        sent = sending.result()

    # The send went first, so the Reminder was sent before the Mortgage closed.
    assert sent.status_code == 200, sent.text
    assert sent.json()["status"] == "sent"


@pytest.fixture
def qa_mode(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("mortgage_backend.platform.clock._QA_MODE", True)


@pytest.mark.usefixtures("qa_mode")
def test_overlapping_reads_on_different_dates_keep_each_others_reminders(
    app_client: TestClient,
) -> None:
    lend(app_client, person(app_client))
    first = app_client.get("/api/reminders", headers={"X-QA-Clock": "2026-05-12"})
    [reminder] = first.json()["items"]  # for 14 May

    def read(day: str) -> int:
        return app_client.get("/api/reminders", headers={"X-QA-Clock": day}).status_code

    # Scenarios on 11 and 12 May read at once, as QA's parallel workers do.
    with ThreadPoolExecutor(max_workers=8) as pool:
        answers = list(pool.map(read, ["2026-05-11", "2026-05-12"] * 8))

    assert set(answers) == {200}
    sent = app_client.post(
        f"/api/reminders/{reminder['id']}/sent", headers={"X-QA-Clock": "2026-05-12"}
    )
    assert sent.status_code == 200, sent.text
