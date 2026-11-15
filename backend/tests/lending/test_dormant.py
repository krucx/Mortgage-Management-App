"""Dormant Mortgages: Active ones that owe nothing, so their jewellery should already
have gone back (ADR 0012). Worked out afresh, never stored (today is 20 Apr 2026)."""

from datetime import date, timedelta

import pytest
from api_seed import SIMPLE_3, lend, pay, person
from conftest import TODAY
from seed import RUPEE, add_customer, add_mortgage, forfeit, redeem, waive

from mortgage_backend.lending.replay import replay


@pytest.fixture
def ramesh(client):
    return person(client)


NOTHING = {**SIMPLE_3, "part_month_rule": "nothing"}


@pytest.fixture
def chain(client, ramesh):
    return lend(client, ramesh, terms=NOTHING)


def dormant(client):
    response = client.get("/api/closures/dormant")
    assert response.status_code == 200, response.text
    return [row["name"] for row in response.json()["items"]]


def owe_nothing(
    client,
    owner,
    mortgage,
    before="2026-04-10",
    after="2026-04-15",
    owed_before=106_000_00,
):
    """Leave a Mortgage of ₹1 lakh at 3% (Part-Month Rule "nothing") owing nothing, as
    only back-dated Payments can now: ₹3,000 `after` its latest Accrual Date for the
    month charged then, then `owed_before` (the Principal and the interest charged by
    `before`) in two back-dated parts, neither of them all that was owed on its date,
    which would Redeem it or be refused. Returns the last back-dated Payment."""
    pay(client, owner, {mortgage["id"]: 3_000_00}, on=after)
    pay(client, owner, {mortgage["id"]: 50_000_00}, on=before)
    day_before = (date.fromisoformat(before) - timedelta(days=1)).isoformat()
    back_dated = pay(
        client, owner, {mortgage["id"]: owed_before - 50_000_00}, on=day_before
    )
    shown = client.get(f"/api/mortgages/{mortgage['id']}").json()
    assert (shown["status"], shown["outstanding"]["total"]) == ("active", 0)
    return back_dated


def test_an_active_mortgage_owing_nothing_is_dormant_until_it_owes_again(
    client, ramesh, chain
):
    assert dormant(client) == []
    payment = owe_nothing(client, ramesh, chain)

    assert dormant(client) == [chain["name"]]

    voided = client.post(
        f"/api/payments/{payment['id']}/void", json={"reason": "Bounced"}
    )
    assert voided.status_code == 200, voided.text
    assert dormant(client) == []


def test_a_dormant_mortgage_is_redeemed_with_no_payment(client, ramesh, chain):
    owe_nothing(client, ramesh, chain)

    response = client.post(
        f"/api/mortgages/{chain['id']}/redeem",
        json={"redeemed_on": "2026-04-20", "method": "cash"},
    )

    assert response.status_code == 200, response.text
    assert response.json()["status"] == "redeemed"
    assert dormant(client) == []


def test_a_closed_mortgage_owing_nothing_is_never_dormant(conn):
    customer = add_customer(conn)
    redeemed, waived, forfeited = (
        add_mortgage(conn, customer, suffix) for suffix in ("Chain", "Ring", "Bangle")
    )
    redeem(conn, redeemed, date(2026, 3, 14))
    waive(conn, waived, date(2026, 3, 20), paid=1_08_000 * RUPEE)
    forfeit(conn, forfeited, date(2026, 3, 20), recovered=90_000 * RUPEE)

    for mortgage in (redeemed, waived, forfeited):
        closed = replay(conn, mortgage)
        assert closed.outstanding(TODAY).total == 0
        assert not closed.dormant(TODAY)


def reminders(client):
    """Each Reminder's Customer and Mortgage Names, for Accrual Dates up to 18 May."""
    settings = client.get("/api/settings/messages").json()
    client.put("/api/settings/messages", json={**settings, "reminder_days_before": 28})
    return [
        (n["customer"]["name"], [m["name"] for m in n["mortgages"]])
        for n in client.get("/api/reminders").json()["items"]
    ]


def test_a_dormant_mortgage_gets_no_reminder(client, ramesh, chain):
    ring = lend(client, ramesh, "2026-02-14", amount=10_000_00, description="Ring")
    sita = person(client, "Sita Devi", "9829054321")
    bangle = lend(client, sita, terms=NOTHING, description="Bangle")
    owe_nothing(client, ramesh, chain)
    owe_nothing(client, sita, bangle)

    # Ramesh's Reminder for 14 May covers only the ring; Sita, owing nothing, gets none.
    assert reminders(client) == [("Ramesh Kumar", [ring["name"]])]


def test_a_dormant_mortgage_is_not_on_the_call_list(client, ramesh):
    accruing_today = lend(client, ramesh, "2026-01-20", terms=NOTHING)
    owe_nothing(
        client,
        ramesh,
        accruing_today,
        before="2026-03-15",
        after="2026-03-25",
        owed_before=103_000_00,
    )

    response = client.get("/api/call-list")
    assert response.status_code == 200, response.text
    assert response.json()["items"] == []
