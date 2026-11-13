"""Reminders: the daily run queues one per Customer per Accrual Date coming up in N days.

The Mortgages here are ₹1,00,000 at 3% Simple, Full month, from 14 Jan 2026 unless
stated: ₹3,000 is added on each 14th, so on 14 May the chain will owe ₹1,15,000, the new
month's Interest to Date included.
"""

import re
from collections.abc import Iterator
from datetime import date, datetime

import pytest
from api_seed import lend, person
from fastapi.testclient import TestClient
from seed import (
    LAKH,
    RUPEE,
    add_customer,
    add_mortgage,
    add_payment,
    forfeit,
    redeem,
    waive,
)
from sqlalchemy.engine import Connection

from mortgage_backend.follow_up.message_settings import (
    MESSAGE_SETTINGS,
    MessageSettings,
)
from mortgage_backend.follow_up.reminders import (
    ReminderAction,
    ReminderNotFound,
    ReminderRefused,
    act,
    is_eligible,
    list_reminders,
    sync,
)
from mortgage_backend.lending.replay import replay
from mortgage_backend.lending.terms import Terms
from mortgage_backend.main import create_app

TODAY = date(2026, 5, 12)
NOW = datetime(2026, 5, 12, 10, 0)


def settings(conn: Connection, today: date = TODAY, **changes: object) -> None:
    MESSAGE_SETTINGS.set(
        conn, MESSAGE_SETTINGS.get(conn).model_copy(update=changes), today
    )


def quotes(message: str, interest: str, owed: str) -> bool:
    """Whether a Reminder's `message` has a Mortgage's lines with these amounts."""
    lines = rf"Interest added\s+{re.escape(interest)}\nOwed after\s+{re.escape(owed)}\n"
    return re.search(lines, message) is not None


def mark_sent(conn: Connection, reminder_id: int, now: datetime = NOW) -> None:
    act(conn, reminder_id, ReminderAction.SEND, now)


def test_a_reminder_is_queued_days_before_the_accrual_date(conn: Connection) -> None:
    ramesh = add_customer(conn)
    add_mortgage(conn, ramesh)

    sync(conn, date(2026, 5, 12))

    [reminder] = list_reminders(conn)
    assert (reminder.customer.name, reminder.accrues_on, reminder.status) == (
        "Ramesh Kumar",
        date(2026, 5, 14),
        "queued",
    )
    assert "*₹3,000* will be added" in reminder.message
    assert "Gold chain\nInterest added    ₹3,000\nOwed after     ₹1,15,000" in (
        reminder.message
    )
    assert "2026-Ramesh" not in reminder.message


def test_is_eligible_decides_which_mortgages_a_reminder_covers(
    conn: Connection,
) -> None:
    nothing = Terms(
        monthly_rate_bps=300, interest_mode="simple", part_month_rule="nothing"
    )
    ramesh = add_customer(conn)
    accruing = add_mortgage(conn, ramesh, suffix="Accruing")
    off_day = add_mortgage(conn, ramesh, suffix="OffDay", start_date=date(2026, 1, 20))
    dormant = add_mortgage(conn, ramesh, suffix="Dormant", terms=nothing)
    add_payment(conn, ramesh, date(2026, 2, 14), {dormant: 103_000 * RUPEE})
    redeemed = add_mortgage(conn, ramesh, suffix="Redeemed")
    redeem(conn, redeemed, date(2026, 2, 1))
    waived = add_mortgage(conn, ramesh, suffix="Waived")
    waive(conn, waived, date(2026, 2, 1))
    forfeited = add_mortgage(conn, ramesh, suffix="Forfeited")
    forfeit(conn, forfeited, date(2026, 2, 1))

    on = date(2026, 2, 14)  # accruing's, dormant's and the closed ones' Accrual Date
    assert is_eligible(replay(conn, accruing), on) is True
    assert is_eligible(replay(conn, off_day), on) is False  # not its Accrual Date
    assert is_eligible(replay(conn, dormant), on) is False
    assert is_eligible(replay(conn, redeemed), on) is False
    assert is_eligible(replay(conn, waived), on) is False
    assert is_eligible(replay(conn, forfeited), on) is False


def test_one_reminder_covers_every_mortgage_accruing_that_day(conn: Connection) -> None:
    ramesh = add_customer(conn)
    add_mortgage(conn, ramesh)
    add_mortgage(conn, ramesh, suffix="Ring", description="Ring", amount_lent=LAKH // 2)

    sync(conn, date(2026, 5, 12))

    [reminder] = list_reminders(conn)
    assert [m.name for m in reminder.mortgages] == [
        "2026-Ramesh-Chain",
        "2026-Ramesh-Ring",
    ]
    assert "Total interest    ₹4,500" in reminder.message


def test_running_again_adds_no_duplicates(conn: Connection) -> None:
    add_mortgage(conn, add_customer(conn))

    sync(conn, date(2026, 5, 12))
    sync(conn, date(2026, 5, 12))
    sync(conn, date(2026, 5, 13))  # 14 May is still 1 day away

    assert len(list_reminders(conn)) == 1


def test_missed_days_are_back_filled_only_for_coming_accrual_dates(
    conn: Connection,
) -> None:
    ramesh = add_customer(conn)
    # Accrue on the 12th, 13th, 14th and 15th; the app was off from 10 to 12 May.
    for day in (12, 13, 14, 15):
        add_mortgage(conn, ramesh, suffix=f"Day{day}", start_date=date(2026, 1, day))
    settings(conn, date(2026, 5, 13), reminder_days_before=3)

    sync(conn, date(2026, 5, 13))

    # Today's (13th) and yesterday's (12th) accrued already; the 14th, 15th and 16th
    # are ahead, so the Reminders missed for the 14th and 15th are made now.
    assert [n.accrues_on for n in list_reminders(conn)] == [
        date(2026, 5, 14),
        date(2026, 5, 15),
    ]


def test_fewer_days_before_withdraws_unsent_reminders_now_too_far_ahead(
    conn: Connection,
) -> None:
    ramesh = add_customer(conn)
    add_mortgage(conn, ramesh, suffix="Soon", start_date=date(2026, 1, 14))
    suresh = add_customer(conn, phone="9829054321")
    add_mortgage(conn, suresh, start_date=date(2026, 1, 25))
    settings(conn, reminder_days_before=15)
    sync(conn, date(2026, 5, 12))
    assert len(list_reminders(conn)) == 2  # 14 and 25 May

    settings(conn, reminder_days_before=2)

    # 25 May is 13 days ahead: its Reminder waits until 23 May, when it is queued again.
    assert [n.accrues_on for n in list_reminders(conn)] == [date(2026, 5, 14)]
    sync(conn, date(2026, 5, 23))
    assert [n.accrues_on for n in list_reminders(conn)] == [
        date(2026, 5, 14),
        date(2026, 5, 25),
    ]


def test_fewer_days_before_keeps_reminders_already_sent(
    conn: Connection,
) -> None:
    add_mortgage(conn, add_customer(conn), start_date=date(2026, 1, 25))
    settings(conn, reminder_days_before=15)
    sync(conn, date(2026, 5, 12))
    (reminder,) = list_reminders(conn)
    mark_sent(conn, reminder.id, NOW)

    settings(conn, reminder_days_before=2)

    assert [n.status for n in list_reminders(conn)] == ["sent"]


def test_approve_first_holds_reminders_for_the_lender(conn: Connection) -> None:
    add_mortgage(conn, add_customer(conn))
    settings(conn, reminder_approve_first=True)

    sync(conn, date(2026, 5, 12))

    assert [n.status for n in list_reminders(conn)] == ["awaiting_approval"]


def test_closed_mortgages_get_no_reminders(conn: Connection) -> None:
    chain = add_mortgage(conn, add_customer(conn))
    redeem(conn, chain, date(2026, 5, 1))

    sync(conn, date(2026, 5, 12))

    assert list_reminders(conn) == []


def test_the_reminder_follows_the_lenders_template(conn: Connection) -> None:
    add_mortgage(conn, add_customer(conn))
    settings(conn, reminder_template="{customer_name}: {interest} on {date}")

    sync(conn, date(2026, 5, 12))

    assert list_reminders(conn)[0].message == "Ramesh Kumar: ₹3,000 on 14 May 2026"


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


def test_the_daily_run_queues_reminders_the_lender_sends(app_client, clock) -> None:
    ramesh = person(app_client)
    lend(app_client, ramesh)
    assert (
        app_client.get("/api/reminders").json()["items"] == []
    )  # 14 May is 3 days away

    clock.today = date(2026, 5, 12)  # the first request today starts the daily run
    [reminder] = app_client.get("/api/reminders").json()["items"]
    assert (reminder["status"], reminder["phones"]) == ("queued", ["9829012345"])

    sent = app_client.post(f"/api/reminders/{reminder['id']}/sent")
    assert sent.status_code == 200, sent.text
    assert sent.json()["status"] == "sent"
    assert app_client.post(f"/api/reminders/{reminder['id']}/skip").status_code == 409


def test_an_awaiting_reminder_is_approved_or_skipped(app_client, clock) -> None:
    settings_now = app_client.get("/api/settings/messages").json()
    app_client.put(
        "/api/settings/messages", json={**settings_now, "reminder_approve_first": True}
    )
    owner = person(app_client, "Suresh Jain", "9829054321")
    for description in ("Ring", "Anklet"):
        lend(
            app_client,
            owner,
            "2026-01-13" if description == "Ring" else "2026-01-14",
            amount=10_000 * RUPEE,
            description=description,
            net_weight_mg=5_000,
        )
    clock.today = date(2026, 5, 12)
    ring, anklet = app_client.get("/api/reminders").json()["items"]

    assert app_client.post(f"/api/reminders/{ring['id']}/sent").status_code == 409
    approved = app_client.post(f"/api/reminders/{ring['id']}/approve").json()
    skipped = app_client.post(f"/api/reminders/{anklet['id']}/skip").json()

    assert (approved["status"], skipped["status"]) == ("queued", "skipped")
    assert [
        n["id"] for n in app_client.get("/api/reminders?status=queued").json()["items"]
    ] == [ring["id"]]


def test_a_queued_reminder_shows_what_is_owed_when_it_is_read(conn: Connection) -> None:
    ramesh = add_customer(conn)
    chain = add_mortgage(conn, ramesh)
    sync(conn, date(2026, 5, 12))

    # Paid after it was queued: ₹9,000 clears the interest charged so far.
    add_payment(conn, ramesh, date(2026, 5, 12), {chain: 9_000 * RUPEE})

    assert "Owed after     ₹1,06,000" in list_reminders(conn)[0].message


def test_interest_paid_ahead_is_still_the_months_interest_added(
    conn: Connection,
) -> None:
    ramesh = add_customer(conn)
    chain = add_mortgage(conn, ramesh)
    # ₹12,000 on 12 May: ₹9,000 of interest, and the month's ₹3,000 paid ahead.
    add_payment(conn, ramesh, date(2026, 5, 12), {chain: 12_000 * RUPEE})

    sync(conn, date(2026, 5, 12))

    assert quotes(list_reminders(conn)[0].message, "₹3,000", "₹1,03,000")


@pytest.mark.parametrize(
    ("rule", "owed"),
    [("full_month", "₹3,180"), ("pro_rata", "₹3,093"), ("nothing", "₹3,090")],
)
def test_a_reminder_quotes_the_months_interest_and_the_outstanding_on_the_accrual_date(
    conn: Connection, rule: str, owed: str
) -> None:
    # ₹3,000 at 3% from 1 Nov: ₹90 charged on 1 Dec, and the new month's Interest to
    # Date that day (₹90 Full month, ₹3 for one day pro-rata, nothing).
    terms = Terms(monthly_rate_bps=300, interest_mode="simple", part_month_rule=rule)
    add_mortgage(
        conn,
        add_customer(conn),
        start_date=date(2026, 11, 1),
        amount_lent=3_000 * RUPEE,
        terms=terms,
    )

    sync(conn, date(2026, 11, 29))

    assert quotes(list_reminders(conn)[0].message, "₹90", owed)


@pytest.mark.parametrize(
    ("mode", "start", "sync_on", "owed"),
    [
        # ₹90 capitalised on 1 Dec: ₹3,090, plus ₹93 (₹92.70, to the rupee) for the month
        # starting then.
        ("compounded_monthly", date(2026, 11, 1), date(2026, 11, 29), "₹3,183"),
        # A year's ₹1,080 capitalised on 1 Nov: ₹4,080, plus ₹122 (₹122.40, to the rupee).
        ("compounded_yearly", date(2025, 11, 1), date(2026, 10, 30), "₹4,202"),
    ],
)
def test_a_compounded_reminder_quotes_the_interest_before_capitalising_and_the_outstanding_after(
    conn: Connection, mode: str, start: date, sync_on: date, owed: str
) -> None:
    terms = Terms(
        monthly_rate_bps=300, interest_mode=mode, part_month_rule="full_month"
    )
    add_mortgage(
        conn,
        add_customer(conn),
        start_date=start,
        amount_lent=3_000 * RUPEE,
        terms=terms,
    )

    sync(conn, sync_on)

    assert quotes(list_reminders(conn)[0].message, "₹90", owed)


def test_a_queued_reminder_covers_a_mortgage_added_later(conn: Connection) -> None:
    ramesh = add_customer(conn)
    add_mortgage(conn, ramesh)
    sync(conn, date(2026, 5, 12))

    add_mortgage(conn, ramesh, suffix="Ring", description="Ring", amount_lent=LAKH // 2)

    [reminder] = list_reminders(conn)
    assert len(reminder.mortgages) == 2
    assert "Ring\nInterest added    ₹1,500" in reminder.message


def test_a_closed_mortgage_is_removed_while_an_active_one_remains(
    conn: Connection,
) -> None:
    ramesh = add_customer(conn)
    closed = add_mortgage(conn, ramesh, suffix="Closed")
    active = add_mortgage(conn, ramesh, suffix="Active", description="Active ring")
    sync(conn, TODAY)
    [reminder] = list_reminders(conn)

    redeem(conn, closed, date(2026, 5, 13))

    [updated] = list_reminders(conn)
    assert [mortgage.id for mortgage in updated.mortgages] == [active]
    assert "Active ring" in updated.message
    assert "Closed" not in updated.message
    assert act(conn, reminder.id, ReminderAction.SEND, NOW).status == "sent"


def test_a_sent_reminder_keeps_the_message_that_was_sent(conn: Connection) -> None:
    ramesh = add_customer(conn)
    chain = add_mortgage(conn, ramesh)
    sync(conn, date(2026, 5, 12))
    [queued] = list_reminders(conn)

    mark_sent(conn, queued.id, NOW)
    add_payment(conn, ramesh, date(2026, 5, 12), {chain: 9_000 * RUPEE})
    settings(conn, reminder_template="changed")

    [sent] = list_reminders(conn)
    assert (sent.status, sent.message) == ("sent", queued.message)


def test_turning_approval_off_queues_the_reminders_waiting_for_it(
    conn: Connection,
) -> None:
    add_mortgage(conn, add_customer(conn))
    settings(conn, reminder_approve_first=True)
    sync(conn, date(2026, 5, 12))

    settings(conn, reminder_approve_first=False)

    assert [n.status for n in list_reminders(conn)] == ["queued"]


def test_turning_approval_on_holds_the_reminders_already_queued(
    conn: Connection,
) -> None:
    add_mortgage(conn, add_customer(conn))
    sync(conn, date(2026, 5, 12))

    settings(conn, reminder_approve_first=True)

    assert [n.status for n in list_reminders(conn)] == ["awaiting_approval"]


def test_saving_settings_with_approval_on_keeps_approved_reminders_approved(
    app_client, clock
) -> None:
    def save(**changes: object) -> None:
        now = app_client.get("/api/settings/messages").json()
        assert app_client.put(
            "/api/settings/messages", json={**now, **changes}
        ).is_success

    save(reminder_approve_first=True)
    owner = person(app_client, "Suresh Jain", "9829054321")
    lend(
        app_client,
        owner,
        "2026-01-13",
        amount=10_000 * RUPEE,
        description="Ring",
        net_weight_mg=5_000,
    )
    clock.today = date(2026, 5, 12)
    (reminder,) = app_client.get("/api/reminders").json()["items"]
    app_client.post(f"/api/reminders/{reminder['id']}/approve")

    save(reminder_template="Namaste {customer_name}, {mortgages}")  # approval still on

    assert [n["status"] for n in app_client.get("/api/reminders").json()["items"]] == [
        "queued"
    ]


def test_the_reminders_page_queues_what_is_due_without_waiting_a_day(
    app_client, clock
) -> None:
    clock.today = date(2026, 5, 12)
    assert (
        app_client.get("/api/reminders").json()["items"] == []
    )  # today's daily run is done
    owner = person(app_client)
    for start in ("2026-01-14", "2026-01-25"):  # accrue on 14 May and 25 May
        lend(app_client, owner, start)

    # Added today: its Reminder shows at once, not tomorrow.
    assert [
        n["accrues_on"] for n in app_client.get("/api/reminders").json()["items"]
    ] == ["2026-05-14"]

    # Reminders 15 days ahead now reach 25 May as well.
    settings_now = app_client.get("/api/settings/messages").json()
    app_client.put(
        "/api/settings/messages", json={**settings_now, "reminder_days_before": 15}
    )
    assert [
        n["accrues_on"] for n in app_client.get("/api/reminders").json()["items"]
    ] == [
        "2026-05-14",
        "2026-05-25",
    ]


def test_the_dashboard_counts_the_reminders_to_send_and_approve(
    app_client, clock
) -> None:
    clock.today = date(2026, 5, 12)
    owner = person(app_client)
    for start in (
        "2026-01-13",
        "2026-01-14",
    ):  # one Reminder for 13 May, one for 14 May
        lend(app_client, owner, start)

    def counts():
        figures = app_client.get("/api/dashboard").json()
        return figures["reminders_to_send"], figures["reminders_to_approve"]

    # Due already, though the day's run came before these Mortgages.
    assert counts() == (2, 0)

    first = app_client.get("/api/reminders").json()["items"][0]
    app_client.post(f"/api/reminders/{first['id']}/sent")
    assert counts() == (1, 0)

    settings_now = app_client.get("/api/settings/messages").json()
    app_client.put(
        "/api/settings/messages", json={**settings_now, "reminder_approve_first": True}
    )
    suresh = person(app_client, "Suresh Jain", "9829054321")
    lend(app_client, suresh, description="Ring", net_weight_mg=5_000)
    # Turning approval on holds Ramesh's unsent one too; Suresh's is new, so it waits.
    assert counts() == (0, 2)


def test_an_approval_lasts_while_approval_stays_on(conn: Connection) -> None:
    ramesh = add_customer(conn)
    add_mortgage(conn, ramesh, suffix="Ring", start_date=date(2026, 1, 13))
    suresh = add_customer(conn, phone="9829054321")
    add_mortgage(conn, suresh)
    settings(conn, reminder_approve_first=True)
    ring, chain = list_reminders(conn)

    act(conn, ring.id, ReminderAction.APPROVE, NOW)
    settings(conn, reminder_template="{customer_name}")
    sync(conn, TODAY)

    assert [(n.id, n.status) for n in list_reminders(conn)] == [
        (ring.id, "queued"),
        (chain.id, "awaiting_approval"),
    ]


def test_turning_approval_on_again_holds_reminders_approved_before(
    conn: Connection,
) -> None:
    add_mortgage(conn, add_customer(conn))
    settings(conn, reminder_approve_first=True)
    [reminder] = list_reminders(conn)
    act(conn, reminder.id, ReminderAction.APPROVE, NOW)

    settings(conn, reminder_approve_first=False)
    settings(conn, reminder_approve_first=True)

    assert [n.status for n in list_reminders(conn)] == ["awaiting_approval"]


def test_a_reminder_is_refused_an_action_its_status_does_not_allow(
    conn: Connection,
) -> None:
    add_mortgage(conn, add_customer(conn))
    settings(conn, reminder_approve_first=True)
    [reminder] = list_reminders(conn)

    with pytest.raises(ReminderRefused, match="awaiting approval"):
        act(conn, reminder.id, ReminderAction.SEND, NOW)
    act(conn, reminder.id, ReminderAction.SKIP, NOW)
    with pytest.raises(ReminderRefused, match="already skipped"):
        act(conn, reminder.id, ReminderAction.APPROVE, NOW)


def test_a_reminder_with_nothing_to_say_cannot_be_approved_or_sent(
    conn: Connection,
) -> None:
    ramesh = add_customer(conn)
    chain = add_mortgage(conn, ramesh)
    settings(conn, reminder_approve_first=True)
    sync(conn, TODAY)
    [reminder] = list_reminders(conn)
    redeem(conn, chain, TODAY)

    with pytest.raises(ReminderRefused, match="skip it"):
        act(conn, reminder.id, ReminderAction.APPROVE, NOW)
    with pytest.raises(ReminderRefused, match="skip it"):
        act(conn, reminder.id, ReminderAction.SEND, NOW)
    assert act(conn, reminder.id, ReminderAction.SKIP, NOW).status == "skipped"


def test_sync_removes_a_fully_ineligible_unsent_reminder(conn: Connection) -> None:
    chain = add_mortgage(conn, add_customer(conn))
    settings(conn, reminder_approve_first=True)
    sync(conn, TODAY)
    [reminder] = list_reminders(conn)
    redeem(conn, chain, TODAY)

    sync(conn, TODAY)

    assert list_reminders(conn) == []


def test_acting_on_a_missing_reminder_is_refused(conn: Connection) -> None:
    with pytest.raises(ReminderNotFound):
        act(conn, 404, ReminderAction.SKIP, NOW)


def test_saving_message_settings_syncs_the_reminders_at_once(conn: Connection) -> None:
    add_mortgage(conn, add_customer(conn), start_date=date(2026, 1, 25))

    MESSAGE_SETTINGS.set(conn, MessageSettings(reminder_days_before=15), TODAY)

    assert [n.accrues_on for n in list_reminders(conn)] == [date(2026, 5, 25)]


def test_a_template_with_an_unknown_placeholder_is_refused(app_client) -> None:
    now = app_client.get("/api/settings/messages").json()

    refused = app_client.put(
        "/api/settings/messages", json={**now, "reminder_template": "Hi {name} {date}"}
    )
    saved = app_client.put(
        "/api/settings/messages", json={**now, "receipt_template": "Hi {customer_name}"}
    )

    assert refused.status_code == 422
    assert "{name}" in refused.json()["detail"]
    assert "Reminder" in refused.json()["detail"]
    assert saved.status_code == 200
    assert (
        app_client.get("/api/settings/messages").json()["reminder_template"]
        == (now["reminder_template"])
    )


def test_the_placeholders_each_template_may_use_are_published(app_client) -> None:
    placeholders = app_client.get("/api/settings/messages/placeholders").json()

    assert placeholders["reminder"] == [
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
