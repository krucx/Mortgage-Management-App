"""Receipts: what a Payment did, ready to send on WhatsApp or print (today is 20 Apr 2026).

Ramesh owes on two Mortgages from 14 Jan at 3% Simple: a ₹1,00,000 gold chain (₹9,000
of interest by 15 Apr) and ₹50,000 of bangles (₹4,500). On 15 Apr he pays ₹7,000: ₹5,000
to the chain and ₹2,000 to the bangles, all of it interest.
"""

from datetime import date

import pytest
from sqlalchemy.engine import Connection

from mortgage_backend.receipts import load_receipt
from seed import LAKH, RUPEE, add_customer, add_mortgage, add_payment


@pytest.fixture
def ramesh(client):
    return client.post(
        "/api/customers",
        json={
            "name": "Ramesh Kumar",
            "address": "",
            "phone_1": "9829012345",
            "phone_2": "9414012345",
        },
    ).json()


def lend(client, owner, rupees, description, start="2026-01-14"):
    response = client.post(
        "/api/mortgages",
        json={
            "customer_id": owner["id"],
            "start_date": start,
            "amount_lent": rupees * RUPEE,
            "description": description,
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
    assert response.status_code == 201, response.text
    return response.json()


def pay(client, owner, **allocations):
    response = client.post(
        "/api/payments",
        json={
            "customer_id": owner["id"],
            "paid_on": "2026-04-15",
            "amount": sum(allocations.values()) * RUPEE,
            "method": "upi",
            "allocations": [
                {"mortgage_id": int(m), "amount": a * RUPEE}
                for m, a in allocations.items()
            ],
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


@pytest.fixture
def payment(client, ramesh):
    chain = lend(client, ramesh, 1_00_000, "Gold chain")
    bangles = lend(client, ramesh, 50_000, "Two bangles")
    return pay(client, ramesh, **{str(chain["id"]): 5_000, str(bangles["id"]): 2_000})


def receipt(client, payment):
    response = client.get(f"/api/payments/{payment['id']}/receipt")
    assert response.status_code == 200, response.text
    return response.json()


def test_a_receipt_lists_what_each_mortgage_was_paid_and_still_owes(client, payment):
    shown = receipt(client, payment)

    assert (shown["customer"]["name"], shown["amount"], shown["method"]) == (
        "Ramesh Kumar",
        7_000 * RUPEE,
        "UPI",
    )
    assert [
        (r["description"], r["paid"], r["interest_paid"], r["principal_paid"], r["owed_after"])
        for r in shown["lines"]
    ] == [
        ("Gold chain", 5_000 * RUPEE, 5_000 * RUPEE, 0, 1_04_000 * RUPEE),
        ("Two bangles", 2_000 * RUPEE, 2_000 * RUPEE, 0, 52_500 * RUPEE),
    ]
    assert shown["phones"] == ["9829012345", "9414012345"]


def test_the_receipt_message_shows_items_not_mortgage_names(client, payment):
    text = receipt(client, payment)["text"]

    assert "Namaste Ramesh Kumar" in text
    assert "*₹7,000* by UPI on 15 Apr 2026" in text
    assert "Gold chain\nPaid              ₹5,000\n" in text
    assert "Total owed     ₹1,56,500\n```" in text
    assert "2026-Ramesh" not in text


def test_the_receipt_follows_the_lenders_template(client, payment):
    settings = client.get("/api/settings/messages").json()
    response = client.put(
        "/api/settings/messages",
        json={**settings, "receipt_template": "Dhanyavaad {customer_name}: {amount}"},
    )
    assert response.status_code == 200, response.text

    assert receipt(client, payment)["text"] == "Dhanyavaad Ramesh Kumar: ₹7,000"


def test_two_pieces_described_alike_are_told_apart_by_start_date(client, ramesh):
    first = lend(client, ramesh, 1_00_000, "Gold chain")
    second = lend(client, ramesh, 50_000, "Gold chain", start="2026-02-10")
    paid = pay(client, ramesh, **{str(first["id"]): 1_000, str(second["id"]): 1_000})

    assert [r["description"] for r in receipt(client, paid)["lines"]] == [
        "Gold chain (from 14 Jan 2026)",
        "Gold chain (from 10 Feb 2026)",
    ]


def test_a_voided_payment_has_no_receipt(client, payment):
    client.post(f"/api/payments/{payment['id']}/void", json={"reason": "typo"})

    response = client.get(f"/api/payments/{payment['id']}/receipt")

    assert response.status_code == 409


def test_a_receipt_is_loaded_with_its_total_owed(conn: Connection) -> None:
    ramesh = add_customer(conn)
    chain = add_mortgage(conn, ramesh)
    bangles = add_mortgage(
        conn, ramesh, suffix="Bangles", description="Two bangles", amount_lent=LAKH // 2
    )
    paid = add_payment(
        conn, ramesh, date(2026, 4, 15), {chain: 5_000 * RUPEE, bangles: 2_000 * RUPEE}
    )

    receipt = load_receipt(conn, paid)

    # The chain owed ₹1,09,000 and the bangles ₹54,500 before it.
    assert [line.owed_after for line in receipt.lines] == [
        1_04_000 * RUPEE,
        52_500 * RUPEE,
    ]
    assert receipt.total_owed == 1_56_500 * RUPEE
    assert "₹1,56,500" in receipt.text
