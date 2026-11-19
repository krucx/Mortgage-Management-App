"""Receipts that explain Advances (ADR 0021): a Payment's Receipt lists each Mortgage's
Advance parts, and cancelling a part has a Receipt of its own.

The Mortgage is a ₹1,00,000 gold chain at 3% Simple from 14 Jan 2026 (₹3,000 a month,
a full month charged as the Interest to Date). On 20 Apr 2026 it owes ₹1,12,000: ₹9,000
is paid now, all interest, and an Advance of ₹9,000 over 3 months lands on 14 May,
14 Jun and 14 Jul."""

from collections.abc import Iterator
from datetime import date
from typing import Any

import pytest
from api_seed import lend, person
from fastapi.testclient import TestClient
from seed import LAKH, RUPEE

from mortgage_backend.main import create_app


class Clock:
    def __init__(self, today: date) -> None:
        self.today = today


@pytest.fixture
def clock() -> Clock:
    return Clock(date(2026, 4, 20))


@pytest.fixture
def client(database_url: str, clock: Clock) -> Iterator[TestClient]:
    with TestClient(create_app(database_url, today=lambda: clock.today)) as client:
        yield client


@pytest.fixture
def ramesh(client):
    return person(client)


@pytest.fixture
def chain(client, ramesh):
    return lend(client, ramesh)


@pytest.fixture
def advance(client, ramesh, chain):
    response = client.post(
        "/api/payments",
        json={
            "customer_id": ramesh["id"],
            "paid_on": "2026-04-20",
            "amount": 18_000 * RUPEE,
            "method": "cash",
            "allocations": [
                {
                    "mortgage_id": chain["id"],
                    "amount": 9_000 * RUPEE,
                    "advance": 9_000 * RUPEE,
                    "months": 3,
                }
            ],
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


def get(client, path) -> Any:
    response = client.get(path)
    assert response.status_code == 200, response.text
    return response.json()


def part(client, mortgage_id, on: str) -> Any:
    [found] = [
        i
        for i in get(client, f"/api/mortgages/{mortgage_id}")["advance_instalments"]
        if i["on"] == on
    ]
    return found


def cancel(client, chain, on: str) -> Any:
    """Cancel the part due `on`, and return its Receipt."""
    instalment = part(client, chain["id"], on)
    response = client.post(
        f"/api/mortgages/{chain['id']}/advance-instalments/{instalment['id']}/cancel"
    )
    assert response.status_code == 200, response.text
    return get(
        client,
        f"/api/payments/{instalment['payment_id']}"
        f"/advance-instalments/{instalment['id']}/receipt",
    )


def test_a_receipt_lists_each_advance_part_with_its_date(client, advance):
    shown = get(client, f"/api/payments/{advance['id']}/receipt")

    [line] = shown["lines"]
    assert (line["paid"], line["interest_paid"], line["owed_after"]) == (
        9_000 * RUPEE,
        9_000 * RUPEE,
        1_03_000 * RUPEE,
    )
    assert line["advance_parts"] == [
        {"on": "2026-05-14", "amount": 3_000 * RUPEE},
        {"on": "2026-06-14", "amount": 3_000 * RUPEE},
        {"on": "2026-07-14", "amount": 3_000 * RUPEE},
    ]
    assert shown["amount"] == 18_000 * RUPEE
    assert (
        "Gold chain\n"
        "Paid now          ₹9,000\n"
        "  Interest        ₹9,000\n"
        "  Principal           ₹0\n"
        "Advance           ₹9,000\n"
        "  On 14 May 2026  ₹3,000\n"
        "  On 14 Jun 2026  ₹3,000\n"
        "  On 14 Jul 2026  ₹3,000\n"
        "Still owed     ₹1,03,000\n"
    ) in shown["text"]


def test_a_receipt_still_shows_a_cancelled_part_as_it_was_received(
    client, chain, advance, clock
):
    clock.today = date(2026, 5, 20)
    cancel(client, chain, "2026-06-14")

    shown = get(client, f"/api/payments/{advance['id']}/receipt")

    assert [p["on"] for p in shown["lines"][0]["advance_parts"]] == [
        "2026-05-14",
        "2026-06-14",
        "2026-07-14",
    ]


def test_cancelling_a_part_has_a_receipt_for_what_it_paid_that_day(
    client, chain, advance, clock
):
    clock.today = date(2026, 5, 20)

    shown = cancel(client, chain, "2026-06-14")

    assert (shown["paid_on"], shown["advance_due_on"], shown["amount"]) == (
        "2026-05-20",
        "2026-06-14",
        3_000 * RUPEE,
    )
    [line] = shown["lines"]
    # 20 May: the Interest to Date from 14 May is ₹3,000, which the part pays.
    assert (
        line["description"],
        line["paid"],
        line["interest_paid"],
        line["principal_paid"],
        line["owed_after"],
        line["advance_parts"],
    ) == ("Gold chain", 3_000 * RUPEE, 3_000 * RUPEE, 0, LAKH, [])
    assert shown["total_owed"] == LAKH
    text = shown["text"]
    assert "Namaste Ramesh Kumar" in text
    assert (
        "*₹3,000* of your Advance received on 20 Apr 2026, due on 14 Jun 2026, "
        "was applied on 20 May 2026."
    ) in text
    assert "Gold chain\nApplied           ₹3,000\n  Interest        ₹3,000\n" in text
    assert "Total still owed: *₹1,00,000*" in text
    assert "2026-Ramesh" not in text


def test_only_a_cancelled_part_has_a_receipt(client, chain, advance, clock):
    clock.today = date(2026, 5, 20)
    upcoming = part(client, chain["id"], "2026-06-14")

    response = client.get(
        f"/api/payments/{advance['id']}/advance-instalments/{upcoming['id']}/receipt"
    )

    assert response.status_code == 404


def test_a_part_of_another_payment_has_no_receipt_under_this_one(
    client, chain, advance, clock
):
    clock.today = date(2026, 5, 20)
    shown = cancel(client, chain, "2026-06-14")
    instalment = part(client, chain["id"], "2026-06-14")

    response = client.get(
        f"/api/payments/{shown['payment_id'] + 1}"
        f"/advance-instalments/{instalment['id']}/receipt"
    )

    assert response.status_code == 404
