"""Notices: the daily run queues one per Customer per Accrual Date coming up in N days.

The Mortgages here are ₹1,00,000 at 3% Simple from 14 Jan 2026 unless stated: ₹3,000 is
added on each 14th, so on 14 May the chain will owe ₹1,12,000.
"""

from collections.abc import Iterator
from datetime import date, datetime

import pytest
from fastapi.testclient import TestClient
from seed import LAKH, RUPEE, add_customer, add_mortgage, add_payment, close
from sqlalchemy.engine import Connection

from mortgage_backend.main import create_app
from mortgage_backend.message_settings import get_message_settings
from mortgage_backend.notices import (
    change_message_settings,
    list_notices,
    mark_sent,
    queue_notices,
)

NOW = datetime(2026, 5, 12, 10, 0)


def settings(conn: Connection, **changes: object) -> None:
    change_message_settings(conn, get_message_settings(conn).model_copy(update=changes))


def test_a_notice_is_queued_days_before_the_accrual_date(conn: Connection) -> None:
    ramesh = add_customer(conn)
    add_mortgage(conn, ramesh)

    queue_notices(conn, date(2026, 5, 12))

    [notice] = list_notices(conn)
    assert (notice.customer.name, notice.accrues_on, notice.status) == (
        "Ramesh Kumar",
        date(2026, 5, 14),
        "queued",
    )
    assert "*₹3,000* will be added" in notice.message
    assert "Gold chain\nInterest added    ₹3,000\nOwed after     ₹1,12,000" in (
        notice.message
    )
    assert "2026-Ramesh" not in notice.message


def test_one_notice_covers_every_mortgage_accruing_that_day(conn: Connection) -> None:
    ramesh = add_customer(conn)
    add_mortgage(conn, ramesh)
    add_mortgage(conn, ramesh, suffix="Ring", description="Ring", amount_lent=LAKH // 2)

    queue_notices(conn, date(2026, 5, 12))

    [notice] = list_notices(conn)
    assert [m.name for m in notice.mortgages] == [
        "2026-Ramesh-Chain",
        "2026-Ramesh-Ring",
    ]
    assert "Total interest    ₹4,500" in notice.message


def test_running_again_adds_no_duplicates(conn: Connection) -> None:
    add_mortgage(conn, add_customer(conn))

    queue_notices(conn, date(2026, 5, 12))
    queue_notices(conn, date(2026, 5, 12))
    queue_notices(conn, date(2026, 5, 13))  # 14 May is still 1 day away

    assert len(list_notices(conn)) == 1


def test_missed_days_are_back_filled_only_for_coming_accrual_dates(
    conn: Connection,
) -> None:
    ramesh = add_customer(conn)
    # Accrue on the 12th, 13th, 14th and 15th; the app was off from 10 to 12 May.
    for day in (12, 13, 14, 15):
        add_mortgage(conn, ramesh, suffix=f"Day{day}", start_date=date(2026, 1, day))
    settings(conn, notice_days_before=3)

    queue_notices(conn, date(2026, 5, 13))

    # Today's (13th) and yesterday's (12th) accrued already; the 14th, 15th and 16th
    # are ahead, so the Notices missed for the 14th and 15th are made now.
    assert [n.accrues_on for n in list_notices(conn)] == [
        date(2026, 5, 14),
        date(2026, 5, 15),
    ]


def test_approve_first_holds_notices_for_the_lender(conn: Connection) -> None:
    add_mortgage(conn, add_customer(conn))
    settings(conn, notice_approve_first=True)

    queue_notices(conn, date(2026, 5, 12))

    assert [n.status for n in list_notices(conn)] == ["awaiting_approval"]


def test_closed_mortgages_get_no_notices(conn: Connection) -> None:
    chain = add_mortgage(conn, add_customer(conn))
    close(conn, chain, status="redeemed", closed_on=date(2026, 5, 1))

    queue_notices(conn, date(2026, 5, 12))

    assert list_notices(conn) == []


def test_the_notice_follows_the_lenders_template(conn: Connection) -> None:
    add_mortgage(conn, add_customer(conn))
    settings(conn, notice_template="{customer_name}: {interest} on {date}")

    queue_notices(conn, date(2026, 5, 12))

    assert list_notices(conn)[0].message == "Ramesh Kumar: ₹3,000 on 14 May 2026"


class Clock:
    def __init__(self, today: date) -> None:
        self.today = today


@pytest.fixture
def clock() -> Clock:
    return Clock(date(2026, 5, 11))


@pytest.fixture
def app_client(database_url: str, clock: Clock) -> Iterator[TestClient]:
    with TestClient(create_app(database_url, today=lambda: clock.today)) as client:
        yield client


def test_the_daily_run_queues_notices_the_lender_sends(app_client, clock) -> None:
    ramesh = app_client.post(
        "/api/customers",
        json={"name": "Ramesh Kumar", "address": "", "phone_1": "9829012345"},
    ).json()
    app_client.post(
        "/api/mortgages",
        json={
            "customer_id": ramesh["id"],
            "start_date": "2026-01-14",
            "amount_lent": LAKH,
            "description": "Gold chain",
            "gross_weight_mg": 20_000,
            "net_weight_mg": 19_000,
            "purity_karat": 22,
            "terms": {
                "monthly_rate_bps": 300,
                "interest_mode": "simple",
                "part_month_rule": "full_month",
            },
        },
    )
    assert app_client.get("/api/notices").json() == []  # 14 May is 3 days away

    clock.today = date(2026, 5, 12)  # the first request today starts the daily run
    [notice] = app_client.get("/api/notices").json()
    assert (notice["status"], notice["phones"]) == ("queued", ["9829012345"])

    sent = app_client.post(f"/api/notices/{notice['id']}/sent")
    assert sent.status_code == 200, sent.text
    assert sent.json()["status"] == "sent"
    assert app_client.post(f"/api/notices/{notice['id']}/skip").status_code == 409


def test_an_awaiting_notice_is_approved_or_skipped(app_client, clock) -> None:
    settings_now = app_client.get("/api/settings/messages").json()
    app_client.put(
        "/api/settings/messages", json={**settings_now, "notice_approve_first": True}
    )
    owner = app_client.post(
        "/api/customers",
        json={"name": "Suresh Jain", "address": "", "phone_1": "9829054321"},
    ).json()
    for description in ("Ring", "Anklet"):
        app_client.post(
            "/api/mortgages",
            json={
                "customer_id": owner["id"],
                "start_date": "2026-01-13" if description == "Ring" else "2026-01-14",
                "amount_lent": 10_000 * RUPEE,
                "description": description,
                "gross_weight_mg": 5_000,
                "net_weight_mg": 5_000,
                "purity_karat": 22,
                "terms": {
                    "monthly_rate_bps": 300,
                    "interest_mode": "simple",
                    "part_month_rule": "full_month",
                },
            },
        )
    clock.today = date(2026, 5, 12)
    ring, anklet = app_client.get("/api/notices").json()

    assert app_client.post(f"/api/notices/{ring['id']}/sent").status_code == 409
    approved = app_client.post(f"/api/notices/{ring['id']}/approve").json()
    skipped = app_client.post(f"/api/notices/{anklet['id']}/skip").json()

    assert (approved["status"], skipped["status"]) == ("queued", "skipped")
    assert [n["id"] for n in app_client.get("/api/notices?status=queued").json()] == [
        ring["id"]
    ]


def test_a_queued_notice_shows_what_is_owed_when_it_is_read(conn: Connection) -> None:
    ramesh = add_customer(conn)
    chain = add_mortgage(conn, ramesh)
    queue_notices(conn, date(2026, 5, 12))

    # Paid after it was queued: ₹1,09,000 owed then, so ₹9,000 clears the interest.
    add_payment(conn, ramesh, date(2026, 5, 12), {chain: 9_000 * RUPEE})

    assert "Owed after     ₹1,03,000" in list_notices(conn)[0].message


def test_a_queued_notice_covers_a_mortgage_added_later(conn: Connection) -> None:
    ramesh = add_customer(conn)
    add_mortgage(conn, ramesh)
    queue_notices(conn, date(2026, 5, 12))

    add_mortgage(conn, ramesh, suffix="Ring", description="Ring", amount_lent=LAKH // 2)

    [notice] = list_notices(conn)
    assert len(notice.mortgages) == 2
    assert "Ring\nInterest added    ₹1,500" in notice.message


def test_a_sent_notice_keeps_the_message_that_was_sent(conn: Connection) -> None:
    ramesh = add_customer(conn)
    chain = add_mortgage(conn, ramesh)
    queue_notices(conn, date(2026, 5, 12))
    [queued] = list_notices(conn)

    mark_sent(conn, queued.id, NOW)
    add_payment(conn, ramesh, date(2026, 5, 12), {chain: 9_000 * RUPEE})
    settings(conn, notice_template="changed")

    [sent] = list_notices(conn)
    assert (sent.status, sent.message) == ("sent", queued.message)


def test_turning_approval_off_queues_the_notices_waiting_for_it(
    conn: Connection,
) -> None:
    add_mortgage(conn, add_customer(conn))
    settings(conn, notice_approve_first=True)
    queue_notices(conn, date(2026, 5, 12))

    settings(conn, notice_approve_first=False)

    assert [n.status for n in list_notices(conn)] == ["queued"]
