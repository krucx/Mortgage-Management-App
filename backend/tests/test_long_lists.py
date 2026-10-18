"""Long lists: pickers get every Mortgage, browsing lists come a page at a time (today is
20 Apr 2026, see conftest). Pages hold 20.
"""

import pytest

from api_seed import RING, lend, nth_person, pay
from seed import RUPEE


def get(client, path, **params):
    response = client.get(f"/api/{path}", params=params)
    assert response.status_code == 200, response.text
    return response.json()


def test_a_picker_gets_every_one_of_a_customers_mortgages(client):
    owner = nth_person(client, 1)
    for _ in range(25):
        lend(client, owner, **RING)

    picked = get(
        client, "mortgages", customer_id=owner["id"], status="active", paged=False
    )

    assert (len(picked["items"]), picked["total"]) == (25, 25)


def test_a_customers_mortgages_come_a_page_at_a_time(client):
    owner = nth_person(client, 1)
    for _ in range(25):
        lend(client, owner, **RING)

    first = get(client, "mortgages", customer_id=owner["id"])
    second = get(client, "mortgages", customer_id=owner["id"], page=2)

    assert (len(first["items"]), len(second["items"]), first["total"]) == (20, 5, 25)
    assert not {m["id"] for m in first["items"]} & {m["id"] for m in second["items"]}


def test_a_customers_closed_mortgages_are_listed_apart_from_the_active_ones(client):
    owner = nth_person(client, 1)
    active, redeemed, forfeited = (lend(client, owner, **RING) for _ in range(3))
    assert client.post(
        f"/api/mortgages/{redeemed['id']}/redeem",
        json={"redeemed_on": "2026-04-20", "method": "cash"},
    ).is_success
    assert client.post(
        f"/api/mortgages/{forfeited['id']}/forfeit",
        json={"forfeited_on": "2026-04-20", "recovered_amount": 0, "note": ""},
    ).is_success

    closed = get(client, "mortgages", customer_id=owner["id"], closed=True)

    assert {m["id"] for m in closed["items"]} == {redeemed["id"], forfeited["id"]}
    assert closed["total"] == 2


@pytest.fixture
def accruing_customers(client):
    """21 Customers whose Mortgages accrue today (20th) or in 2 days (22nd); the first
    has 3 of each, so a group bigger than one row."""
    owners = [nth_person(client, n) for n in range(1, 22)]
    for owner in owners:
        for _ in range(3 if owner is owners[0] else 1):
            lend(client, owner, "2026-01-20", **RING)
            lend(client, owner, "2026-01-22", **RING)
    return owners


def test_the_call_list_comes_a_page_of_customers_at_a_time(client, accruing_customers):
    first = get(client, "call-list")
    second = get(client, "call-list", page=2)

    assert (len(first["items"]), len(second["items"]), first["total"]) == (20, 1, 21)
    # A Customer's Mortgages stay together: all 3 of the first's accruing today.
    by_name = {g["customer"]["name"]: g for g in first["items"] + second["items"]}
    assert len(by_name["Customer 01"]["rows"]) == 3
    # 23 Mortgages (the first Customer's 3, one each for the rest), as on the Dashboard.
    assert first["mortgages"] == get(client, "dashboard")["call_list_count"] == 23


def test_notices_come_a_page_at_a_time(client, accruing_customers):
    first = get(client, "notices", status="queued")
    second = get(client, "notices", status="queued", page=2)

    assert (len(first["items"]), len(second["items"]), first["total"]) == (20, 1, 21)
    assert get(client, "dashboard")["notices_to_send"] == 21


def test_ready_to_redeem_comes_a_page_at_a_time(client):
    owner = nth_person(client, 1)
    for _ in range(21):
        mortgage = lend(client, owner, **RING)
        # ₹10,000 at 3% from 14 Jan: ₹900 of interest by 20 Apr, ₹10,900 in all.
        pay(client, owner, {mortgage["id"]: 10_900 * RUPEE}, on="2026-04-20")

    first = get(client, "closures/ready-to-redeem")
    second = get(client, "closures/ready-to-redeem", page=2)

    assert (len(first["items"]), len(second["items"]), first["total"]) == (20, 1, 21)
