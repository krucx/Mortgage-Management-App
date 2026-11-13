"""The Payment Preview decides the Discount (review pass 7, item 02): each Allocation's
room for a Discount after its cash, and whether it is over the confirmation threshold.
Today is 20 Apr 2026 (see conftest)."""

import pytest
from api_seed import lend, person
from seed import RUPEE


@pytest.fixture
def ramesh(client):
    return person(client)


@pytest.fixture
def mortgage(client, ramesh):
    return lend(client, ramesh, name="2026-Ramesh-GoldChain")


def set_discount_confirmation_limit(client, value):
    response = client.put(
        "/api/settings/discount-confirmation-limit",
        json={"discount_confirmation_limit": value},
    )
    assert response.status_code == 200, response.text


def payment_of(ramesh, mortgage, on, amount, discount=0):
    return {
        "customer_id": ramesh["id"],
        "paid_on": on,
        "amount": amount,
        "method": "cash",
        "allocations": [
            {"mortgage_id": mortgage["id"], "amount": amount, "discount": discount}
        ],
    }


def preview(client, body):
    response = client.post("/api/payments/preview", json=body)
    assert response.status_code == 200, response.text
    [only] = response.json()["mortgages"]
    return only


def test_a_discount_larger_than_the_room_after_cash_is_reported_not_refused(
    client, ramesh, mortgage
):
    # ₹1,00,000 cash leaves ₹12,000 of room; ₹20,000 Discount is more.
    asked = payment_of(
        ramesh, mortgage, "2026-04-15", 1_00_000 * RUPEE, discount=20_000 * RUPEE
    )

    shown = preview(client, asked)

    assert shown["discount_room"] == 12_000 * RUPEE


def test_a_discount_within_its_room_is_reported_too(client, ramesh, mortgage):
    # The same ₹12,000 of room; a ₹5,000 Discount fits inside it.
    asked = payment_of(
        ramesh, mortgage, "2026-04-15", 1_00_000 * RUPEE, discount=5_000 * RUPEE
    )

    shown = preview(client, asked)

    assert shown["discount_room"] == 12_000 * RUPEE


def test_a_discount_over_the_confirmation_threshold_is_flagged(
    client, ramesh, mortgage
):
    set_discount_confirmation_limit(client, 5_000 * RUPEE)
    over = preview(
        client, payment_of(ramesh, mortgage, "2026-04-15", 0, discount=5_001 * RUPEE)
    )
    at_limit = preview(
        client, payment_of(ramesh, mortgage, "2026-04-15", 0, discount=5_000 * RUPEE)
    )

    assert (over["over_threshold"], at_limit["over_threshold"]) == (True, False)
