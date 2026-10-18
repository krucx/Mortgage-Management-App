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
from mortgage_backend.message_settings import MESSAGE_SETTINGS, MessageSettings
from mortgage_backend.notices import (
    NoticeAction,
    NoticeNotFound,
    NoticeRefused,
    act,
    list_notices,
    sync,
)

TODAY = date(2026, 5, 12)
NOW = datetime(2026, 5, 12, 10, 0)


def settings(conn: Connection, today: date = TODAY, **changes: object) -> None:
    MESSAGE_SETTINGS.set(
        conn, MESSAGE_SETTINGS.get(conn).model_copy(update=changes), today
    )


def mark_sent(conn: Connection, notice_id: int, now: datetime = NOW) -> None:
    act(conn, notice_id, NoticeAction.SEND, now)


def test_a_notice_is_queued_days_before_the_accrual_date(conn: Connection) -> None:
    ramesh = add_customer(conn)
    add_mortgage(conn, ramesh)

    sync(conn, date(2026, 5, 12))

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

    sync(conn, date(2026, 5, 12))

    [notice] = list_notices(conn)
    assert [m.name for m in notice.mortgages] == [
        "2026-Ramesh-Chain",
        "2026-Ramesh-Ring",
    ]
    assert "Total interest    ₹4,500" in notice.message


def test_running_again_adds_no_duplicates(conn: Connection) -> None:
    add_mortgage(conn, add_customer(conn))

    sync(conn, date(2026, 5, 12))
    sync(conn, date(2026, 5, 12))
    sync(conn, date(2026, 5, 13))  # 14 May is still 1 day away

    assert len(list_notices(conn)) == 1


def test_missed_days_are_back_filled_only_for_coming_accrual_dates(
    conn: Connection,
) -> None:
    ramesh = add_customer(conn)
    # Accrue on the 12th, 13th, 14th and 15th; the app was off from 10 to 12 May.
    for day in (12, 13, 14, 15):
        add_mortgage(conn, ramesh, suffix=f"Day{day}", start_date=date(2026, 1, day))
    settings(conn, date(2026, 5, 13), notice_days_before=3)

    sync(conn, date(2026, 5, 13))

    # Today's (13th) and yesterday's (12th) accrued already; the 14th, 15th and 16th
    # are ahead, so the Notices missed for the 14th and 15th are made now.
    assert [n.accrues_on for n in list_notices(conn)] == [
        date(2026, 5, 14),
        date(2026, 5, 15),
    ]


def test_fewer_days_before_withdraws_unsent_notices_now_too_far_ahead(
    conn: Connection,
) -> None:
    ramesh = add_customer(conn)
    add_mortgage(conn, ramesh, suffix="Soon", start_date=date(2026, 1, 14))
    suresh = add_customer(conn, phone="9829054321")
    add_mortgage(conn, suresh, start_date=date(2026, 1, 25))
    settings(conn, notice_days_before=15)
    sync(conn, date(2026, 5, 12))
    assert len(list_notices(conn)) == 2  # 14 and 25 May

    settings(conn, notice_days_before=2)

    # 25 May is 13 days ahead: its Notice waits until 23 May, when it is queued again.
    assert [n.accrues_on for n in list_notices(conn)] == [date(2026, 5, 14)]
    sync(conn, date(2026, 5, 23))
    assert [n.accrues_on for n in list_notices(conn)] == [
        date(2026, 5, 14),
        date(2026, 5, 25),
    ]


def test_fewer_days_before_keeps_notices_already_sent(
    conn: Connection,
) -> None:
    add_mortgage(conn, add_customer(conn), start_date=date(2026, 1, 25))
    settings(conn, notice_days_before=15)
    sync(conn, date(2026, 5, 12))
    (notice,) = list_notices(conn)
    mark_sent(conn, notice.id, NOW)

    settings(conn, notice_days_before=2)

    assert [n.status for n in list_notices(conn)] == ["sent"]


def test_approve_first_holds_notices_for_the_lender(conn: Connection) -> None:
    add_mortgage(conn, add_customer(conn))
    settings(conn, notice_approve_first=True)

    sync(conn, date(2026, 5, 12))

    assert [n.status for n in list_notices(conn)] == ["awaiting_approval"]


def test_closed_mortgages_get_no_notices(conn: Connection) -> None:
    chain = add_mortgage(conn, add_customer(conn))
    close(conn, chain, status="redeemed", closed_on=date(2026, 5, 1))

    sync(conn, date(2026, 5, 12))

    assert list_notices(conn) == []


def test_the_notice_follows_the_lenders_template(conn: Connection) -> None:
    add_mortgage(conn, add_customer(conn))
    settings(conn, notice_template="{customer_name}: {interest} on {date}")

    sync(conn, date(2026, 5, 12))

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
    assert app_client.get("/api/notices").json()["items"] == []  # 14 May is 3 days away

    clock.today = date(2026, 5, 12)  # the first request today starts the daily run
    [notice] = app_client.get("/api/notices").json()["items"]
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
    ring, anklet = app_client.get("/api/notices").json()["items"]

    assert app_client.post(f"/api/notices/{ring['id']}/sent").status_code == 409
    approved = app_client.post(f"/api/notices/{ring['id']}/approve").json()
    skipped = app_client.post(f"/api/notices/{anklet['id']}/skip").json()

    assert (approved["status"], skipped["status"]) == ("queued", "skipped")
    assert [n["id"] for n in app_client.get("/api/notices?status=queued").json()["items"]] == [
        ring["id"]
    ]


def test_a_queued_notice_shows_what_is_owed_when_it_is_read(conn: Connection) -> None:
    ramesh = add_customer(conn)
    chain = add_mortgage(conn, ramesh)
    sync(conn, date(2026, 5, 12))

    # Paid after it was queued: ₹1,09,000 owed then, so ₹9,000 clears the interest.
    add_payment(conn, ramesh, date(2026, 5, 12), {chain: 9_000 * RUPEE})

    assert "Owed after     ₹1,03,000" in list_notices(conn)[0].message


def test_a_queued_notice_covers_a_mortgage_added_later(conn: Connection) -> None:
    ramesh = add_customer(conn)
    add_mortgage(conn, ramesh)
    sync(conn, date(2026, 5, 12))

    add_mortgage(conn, ramesh, suffix="Ring", description="Ring", amount_lent=LAKH // 2)

    [notice] = list_notices(conn)
    assert len(notice.mortgages) == 2
    assert "Ring\nInterest added    ₹1,500" in notice.message


def test_a_sent_notice_keeps_the_message_that_was_sent(conn: Connection) -> None:
    ramesh = add_customer(conn)
    chain = add_mortgage(conn, ramesh)
    sync(conn, date(2026, 5, 12))
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
    sync(conn, date(2026, 5, 12))

    settings(conn, notice_approve_first=False)

    assert [n.status for n in list_notices(conn)] == ["queued"]


def test_turning_approval_on_holds_the_notices_already_queued(
    conn: Connection,
) -> None:
    add_mortgage(conn, add_customer(conn))
    sync(conn, date(2026, 5, 12))

    settings(conn, notice_approve_first=True)

    assert [n.status for n in list_notices(conn)] == ["awaiting_approval"]


def test_saving_settings_with_approval_on_keeps_approved_notices_approved(
    app_client, clock
) -> None:
    def save(**changes: object) -> None:
        now = app_client.get("/api/settings/messages").json()
        assert app_client.put("/api/settings/messages", json={**now, **changes}).is_success

    save(notice_approve_first=True)
    owner = app_client.post(
        "/api/customers",
        json={"name": "Suresh Jain", "address": "", "phone_1": "9829054321"},
    ).json()
    app_client.post(
        "/api/mortgages",
        json={
            "customer_id": owner["id"],
            "start_date": "2026-01-13",
            "amount_lent": 10_000 * RUPEE,
            "description": "Ring",
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
    (notice,) = app_client.get("/api/notices").json()["items"]
    app_client.post(f"/api/notices/{notice['id']}/approve")

    save(notice_template="Namaste {customer_name}, {mortgages}")  # approval still on

    assert [n["status"] for n in app_client.get("/api/notices").json()["items"]] == [
        "queued"
    ]


def test_the_notices_page_queues_what_is_due_without_waiting_a_day(
    app_client, clock
) -> None:
    clock.today = date(2026, 5, 12)
    assert app_client.get("/api/notices").json()["items"] == []  # today's daily run is done
    owner = app_client.post(
        "/api/customers",
        json={"name": "Ramesh Kumar", "address": "", "phone_1": "9829012345"},
    ).json()
    for start in ("2026-01-14", "2026-01-25"):  # accrue on 14 May and 25 May
        app_client.post(
            "/api/mortgages",
            json={
                "customer_id": owner["id"],
                "start_date": start,
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

    # Added today: its Notice shows at once, not tomorrow.
    assert [n["accrues_on"] for n in app_client.get("/api/notices").json()["items"]] == [
        "2026-05-14"
    ]

    # Notices 15 days ahead now reach 25 May as well.
    settings_now = app_client.get("/api/settings/messages").json()
    app_client.put(
        "/api/settings/messages", json={**settings_now, "notice_days_before": 15}
    )
    assert [n["accrues_on"] for n in app_client.get("/api/notices").json()["items"]] == [
        "2026-05-14",
        "2026-05-25",
    ]


def test_the_dashboard_counts_the_notices_to_send_and_approve(app_client, clock) -> None:
    clock.today = date(2026, 5, 12)
    owner = app_client.post(
        "/api/customers",
        json={"name": "Ramesh Kumar", "address": "", "phone_1": "9829012345"},
    ).json()
    for start in ("2026-01-13", "2026-01-14"):  # one Notice for 13 May, one for 14 May
        app_client.post(
            "/api/mortgages",
            json={
                "customer_id": owner["id"],
                "start_date": start,
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

    def counts():
        figures = app_client.get("/api/dashboard").json()
        return figures["notices_to_send"], figures["notices_to_approve"]

    # Due already, though the day's run came before these Mortgages.
    assert counts() == (2, 0)

    first = app_client.get("/api/notices").json()["items"][0]
    app_client.post(f"/api/notices/{first['id']}/sent")
    assert counts() == (1, 0)

    settings_now = app_client.get("/api/settings/messages").json()
    app_client.put(
        "/api/settings/messages", json={**settings_now, "notice_approve_first": True}
    )
    suresh = app_client.post(
        "/api/customers",
        json={"name": "Suresh Jain", "address": "", "phone_1": "9829054321"},
    ).json()
    app_client.post(
        "/api/mortgages",
        json={
            "customer_id": suresh["id"],
            "start_date": "2026-01-14",
            "amount_lent": LAKH,
            "description": "Ring",
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
    # Turning approval on holds Ramesh's unsent one too; Suresh's is new, so it waits.
    assert counts() == (0, 2)


def test_an_approval_lasts_while_approval_stays_on(conn: Connection) -> None:
    ramesh = add_customer(conn)
    add_mortgage(conn, ramesh, suffix="Ring", start_date=date(2026, 1, 13))
    suresh = add_customer(conn, phone="9829054321")
    add_mortgage(conn, suresh)
    settings(conn, notice_approve_first=True)
    ring, chain = list_notices(conn)

    act(conn, ring.id, NoticeAction.APPROVE, NOW)
    settings(conn, notice_template="{customer_name}")
    sync(conn, TODAY)

    assert [(n.id, n.status) for n in list_notices(conn)] == [
        (ring.id, "queued"),
        (chain.id, "awaiting_approval"),
    ]


def test_turning_approval_on_again_holds_notices_approved_before(
    conn: Connection,
) -> None:
    add_mortgage(conn, add_customer(conn))
    settings(conn, notice_approve_first=True)
    [notice] = list_notices(conn)
    act(conn, notice.id, NoticeAction.APPROVE, NOW)

    settings(conn, notice_approve_first=False)
    settings(conn, notice_approve_first=True)

    assert [n.status for n in list_notices(conn)] == ["awaiting_approval"]


def test_a_notice_is_refused_an_action_its_status_does_not_allow(
    conn: Connection,
) -> None:
    add_mortgage(conn, add_customer(conn))
    settings(conn, notice_approve_first=True)
    [notice] = list_notices(conn)

    with pytest.raises(NoticeRefused, match="awaiting approval"):
        act(conn, notice.id, NoticeAction.SEND, NOW)
    act(conn, notice.id, NoticeAction.SKIP, NOW)
    with pytest.raises(NoticeRefused, match="already skipped"):
        act(conn, notice.id, NoticeAction.APPROVE, NOW)


def test_a_notice_with_nothing_to_say_can_only_be_skipped(conn: Connection) -> None:
    ramesh = add_customer(conn)
    chain = add_mortgage(conn, ramesh)
    sync(conn, TODAY)
    [notice] = list_notices(conn)
    close(conn, chain, status="redeemed", closed_on=TODAY)

    with pytest.raises(NoticeRefused, match="skip it"):
        act(conn, notice.id, NoticeAction.SEND, NOW)
    assert act(conn, notice.id, NoticeAction.SKIP, NOW).status == "skipped"


def test_acting_on_a_missing_notice_is_refused(conn: Connection) -> None:
    with pytest.raises(NoticeNotFound):
        act(conn, 404, NoticeAction.SKIP, NOW)


def test_saving_message_settings_syncs_the_notices_at_once(conn: Connection) -> None:
    add_mortgage(conn, add_customer(conn), start_date=date(2026, 1, 25))

    MESSAGE_SETTINGS.set(conn, MessageSettings(notice_days_before=15), TODAY)

    assert [n.accrues_on for n in list_notices(conn)] == [date(2026, 5, 25)]


def test_a_template_with_an_unknown_placeholder_is_refused(app_client) -> None:
    now = app_client.get("/api/settings/messages").json()

    refused = app_client.put(
        "/api/settings/messages", json={**now, "notice_template": "Hi {name} {date}"}
    )
    saved = app_client.put(
        "/api/settings/messages", json={**now, "receipt_template": "Hi {customer_name}"}
    )

    assert refused.status_code == 422
    assert "{name}" in refused.json()["detail"]
    assert "Notice" in refused.json()["detail"]
    assert saved.status_code == 200
    assert app_client.get("/api/settings/messages").json()["notice_template"] == (
        now["notice_template"]
    )


def test_the_placeholders_each_template_may_use_are_published(app_client) -> None:
    placeholders = app_client.get("/api/settings/messages/placeholders").json()

    assert placeholders["notice"] == [
        "customer_name",
        "date",
        "interest",
        "mortgages",
        "total_owed",
    ]
    assert "method" in placeholders["receipt"]


def test_a_receipt_template_with_a_malformed_placeholder_is_refused(app_client) -> None:
    now = app_client.get("/api/settings/messages").json()

    refused = app_client.put(
        "/api/settings/messages",
        json={**now, "receipt_template": "Hi {customer-name}, {amount} received"},
    )

    assert refused.status_code == 422
    assert refused.json()["detail"].startswith(
        "The Receipt template can't fill {customer-name}."
    )
