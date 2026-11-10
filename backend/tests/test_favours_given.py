"""Favours Given: every Discount and Waived Amount the Lender has given a Customer,
across their Mortgages, still standing."""

import pytest
from api_seed import lend, person


@pytest.fixture
def ramesh(client):
    return person(client)


@pytest.fixture
def chain(client, ramesh):
    return lend(client, ramesh, description="Gold chain")


def favours(client, customer):
    response = client.get(f"/api/customers/{customer['id']}/favours")
    assert response.status_code == 200, response.text
    return response.json()


def discounted(client, customer, mortgage, discount, on="2026-04-15", cash=2_000_00):
    """A Payment of `cash` on `mortgage` with a Discount of `discount`."""
    response = client.post(
        "/api/payments",
        json={
            "customer_id": customer["id"],
            "paid_on": on,
            "amount": cash,
            "method": "cash",
            "allocations": [
                {"mortgage_id": mortgage["id"], "amount": cash, "discount": discount}
            ],
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


def test_a_discount_is_a_favour(client, ramesh, chain):
    discounted(client, ramesh, chain, 8_000_00)

    assert favours(client, ramesh) == {
        "favours": [
            {
                "on": "2026-04-15",
                "mortgage": {"id": chain["id"], "description": "Gold chain"},
                "kind": "discount",
                "amount": 8_000_00,
            }
        ],
        "total": 8_000_00,
    }


def waive(client, mortgage, paid, on="2026-04-20"):
    response = client.post(
        f"/api/mortgages/{mortgage['id']}/waive",
        json={"waived_on": on, "amount_paid": paid, "method": "cash"},
    )
    assert response.status_code == 200, response.text


def test_a_waived_amount_is_a_favour(client, ramesh, chain):
    # ₹1,12,000 owed on 20 Apr; ₹1,11,500 paid, ₹500 let off.
    waive(client, chain, 111_500_00)

    assert favours(client, ramesh)["favours"] == [
        {
            "on": "2026-04-20",
            "mortgage": {"id": chain["id"], "description": "Gold chain"},
            "kind": "waiver",
            "amount": 500_00,
        }
    ]


def test_a_voided_payments_discount_is_left_out(client, ramesh, chain):
    payment = discounted(client, ramesh, chain, 8_000_00)
    client.post(f"/api/payments/{payment['id']}/void", json={"reason": "Bounced"})

    assert favours(client, ramesh) == {"favours": [], "total": 0}


def test_a_reopened_waiver_is_left_out(client, ramesh, chain):
    waive(client, chain, 111_500_00)
    client.post(f"/api/mortgages/{chain['id']}/reopen", json={"reason": "Mistake"})

    assert favours(client, ramesh) == {"favours": [], "total": 0}


def test_favours_on_every_mortgage_are_listed_newest_first_with_their_total(
    client, ramesh, chain
):
    ring = lend(client, ramesh, description="Gold ring")
    someone_else = person(client, "Suresh Shah", "9829054321")
    their_chain = lend(client, someone_else)
    discounted(client, ramesh, ring, 1_000_00, on="2026-03-15")
    discounted(client, someone_else, their_chain, 3_000_00, on="2026-03-16")
    waive(client, chain, 111_500_00, on="2026-04-20")
    discounted(client, ramesh, ring, 2_000_00, on="2026-04-15")

    listed = favours(client, ramesh)

    assert [
        (f["on"], f["mortgage"]["description"], f["kind"], f["amount"])
        for f in listed["favours"]
    ] == [
        ("2026-04-20", "Gold chain", "waiver", 500_00),
        ("2026-04-15", "Gold ring", "discount", 2_000_00),
        ("2026-03-15", "Gold ring", "discount", 1_000_00),
    ]
    assert listed["total"] == 3_500_00


def test_an_unknown_customer_has_no_favours(client):
    assert client.get("/api/customers/999/favours").status_code == 404
