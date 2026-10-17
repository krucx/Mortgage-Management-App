"""Each request replays a Mortgage once: the Dashboard, Notices, Call List and Ready to
Redeem share the replays they need instead of each working them out again (today is
20 Apr 2026, see conftest)."""

from collections import Counter
from collections.abc import Iterator
from datetime import date
from typing import Any

import pytest
from seed import LAKH, add_customer, add_mortgage, add_payment, close
from sqlalchemy import event, select
from sqlalchemy.engine import Connection, Engine, RowMapping

from mortgage_backend import notices
from mortgage_backend.call_list import call_list
from mortgage_backend.db import make_engine, mortgage_table
from mortgage_backend.replay import MortgageReplay, replays

TODAY = date(2026, 4, 20)


@pytest.fixture
def replayed_ids(monkeypatch: pytest.MonkeyPatch) -> list[int]:
    """The id of every Mortgage replayed, once per replay."""
    seen: list[int] = []
    original = MortgageReplay.__init__

    def counting(self: MortgageReplay, row: RowMapping, *args: Any, **kw: Any) -> None:
        seen.append(row["id"])
        original(self, row, *args, **kw)

    monkeypatch.setattr(MortgageReplay, "__init__", counting)
    return seen


@pytest.fixture
def seeded(client, database_url: str) -> Iterator[None]:
    """A book with something on every list, written once the app has migrated."""
    with make_engine(database_url).begin() as conn:
        ramesh = add_customer(conn)
        add_mortgage(conn, ramesh)  # 3 Months Unpaid: on the Call List
        add_mortgage(conn, ramesh, suffix="Ring", start_date=date(2026, 1, 22))
        sita = add_customer(conn, phone="9829054321")
        paid = add_mortgage(conn, sita, suffix="Paid", start_date=date(2026, 4, 1))
        add_payment(conn, sita, date(2026, 4, 10), {paid: LAKH})  # ready to redeem
        old = add_mortgage(conn, sita, suffix="Old", start_date=date(2025, 6, 1))
        close(conn, old, status="redeemed", closed_on=date(2026, 4, 5))
    yield


@pytest.fixture
def statements() -> Iterator[list[str]]:
    """Every SQL statement run while the test runs."""
    run: list[str] = []

    def record(conn: Any, cursor: Any, statement: str, *args: Any) -> None:
        run.append(statement)

    event.listen(Engine, "before_cursor_execute", record)
    yield run
    event.remove(Engine, "before_cursor_execute", record)


def once_each(seen: list[int]) -> bool:
    """Some Mortgages were replayed, and none more than once."""
    return bool(seen) and set(Counter(seen).values()) == {1}


def test_the_dashboard_replays_each_mortgage_once(client, seeded, replayed_ids):
    figures = client.get("/api/dashboard").json()

    assert (figures["call_list_count"], figures["notices_to_send"]) == (1, 1)
    assert once_each(replayed_ids)


def test_ready_to_redeem_replays_each_mortgage_once(client, seeded, replayed_ids):
    ready = client.get("/api/closures/ready-to-redeem").json()["items"]

    assert [r["mortgage"]["name"] for r in ready] == ["2026-Ramesh-Paid"]
    assert once_each(replayed_ids)


def test_the_notices_page_replays_each_mortgage_once(client, seeded, replayed_ids):
    [notice] = client.get("/api/notices").json()["items"]

    assert notice["accrues_on"] == "2026-04-22"
    assert once_each(replayed_ids)


def test_more_notices_take_no_more_queries(
    client, database_url: str, statements: list[str]
) -> None:
    def queries_to_list(expected: int) -> int:
        assert len(client.get("/api/notices").json()["items"]) == expected  # queues
        statements.clear()
        client.get("/api/notices")
        return len(statements)

    settings_now = client.get("/api/settings/messages").json()
    client.put("/api/settings/messages", json={**settings_now, "notice_days_before": 5})
    engine = make_engine(database_url)
    with engine.begin() as conn:
        ramesh = add_customer(conn)
        add_mortgage(conn, ramesh, start_date=date(2026, 1, 21))
    one = queries_to_list(1)

    with engine.begin() as conn:
        # Ramesh again on another day, and Sita with two Mortgages on one day
        add_mortgage(conn, ramesh, suffix="Ring", start_date=date(2026, 1, 23))
        sita = add_customer(conn, phone="9829054321")
        add_mortgage(conn, sita, suffix="Bangle", start_date=date(2026, 1, 22))
        add_mortgage(conn, sita, suffix="Anklet", start_date=date(2026, 1, 22))

    assert queries_to_list(3) == one


def test_the_call_list_uses_the_replays_it_is_given(
    conn: Connection, replayed_ids: list[int]
) -> None:
    ramesh = add_customer(conn)
    # Feb, Mar, Apr unpaid, and ₹1,09,000 owed on jewellery valued at ₹1,00,000
    add_mortgage(
        conn,
        ramesh,
        suffix="Three",
        collateral_override=LAKH,
        collateral_override_on=TODAY,
    )
    sita = add_customer(conn, phone="9829054321")
    add_mortgage(conn, sita, suffix="Four", start_date=date(2025, 12, 1))
    add_mortgage(conn, sita, suffix="Today", start_date=date(2026, 3, 20))
    rows = conn.execute(select(mortgage_table)).mappings().all()
    replayed = replays(conn, rows)
    replayed_ids.clear()

    groups = call_list(conn, TODAY, replayed)

    assert [
        (row.mortgage_name, row.reasons) for group in groups for row in group.rows
    ] == [
        ("2026-Ramesh-Four", ["months_unpaid"]),
        ("2026-Ramesh-Today", ["accrues_today"]),
        ("2026-Ramesh-Three", ["months_unpaid", "loan_to_value"]),
    ]
    assert replayed_ids == []


def test_notices_with_something_to_send_are_counted_without_a_replay(
    conn: Connection, replayed_ids: list[int]
) -> None:
    ramesh = add_customer(conn)
    add_mortgage(conn, ramesh, start_date=date(2026, 1, 21))
    sita = add_customer(conn, phone="9829054321")
    gone = add_mortgage(conn, sita, suffix="Gone", start_date=date(2026, 1, 22))
    notices.sync(conn, TODAY)
    close(conn, gone, status="redeemed", closed_on=TODAY)  # nothing left to say

    assert notices.unsent_counts(conn) == {
        notices.NoticeStatus.QUEUED: 1,
        notices.NoticeStatus.AWAITING_APPROVAL: 0,
    }
    assert replayed_ids == []
