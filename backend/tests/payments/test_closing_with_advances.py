"""Closing a Mortgage with upcoming Advance Instalments (ADR 0021): the Closure applies
every upcoming part on its date, before any final Payment, so less is left to pay, and
a Reopen puts them back as upcoming.

The Mortgage is ₹1,00,000 at 3% Simple from 14 Jan 2026 (₹3,000 a month, a full month
charged as the Interest to Date). On 20 Apr 2026 ₹9,000 is paid now and an Advance of
₹9,000 over 3 months, landing on 14 May, 14 Jun and 14 Jul. On 20 May, when the 14 May
part is applied, it owes ₹1,03,000 (the Interest to Date from 14 May included) and the
other two parts hold ₹6,000."""

from collections.abc import Iterator
from datetime import date
from typing import Any

import pytest
from api_seed import lend, person
from fastapi.testclient import TestClient
from seed import RUPEE

from mortgage_backend.main import create_app

ON = "2026-05-20"


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


def advance_on(client, ramesh, mortgage_id: int) -> Any:
    """₹9,000 paid now and an Advance of ₹9,000 over 3 months, on 20 Apr."""
    response = client.post(
        "/api/payments",
        json={
            "customer_id": ramesh["id"],
            "paid_on": "2026-04-20",
            "amount": 18_000 * RUPEE,
            "method": "cash",
            "allocations": [
                {
                    "mortgage_id": mortgage_id,
                    "amount": 9_000 * RUPEE,
                    "advance": 9_000 * RUPEE,
                    "months": 3,
                }
            ],
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


@pytest.fixture
def advance(client, ramesh, chain, clock):
    """The Payment with the Advance, seen on 20 May."""
    payment = advance_on(client, ramesh, chain["id"])
    clock.today = date(2026, 5, 20)
    return payment


def ok(response) -> Any:
    assert response.status_code == 200, response.text
    return response.json()


def mortgage(client, mortgage_id):
    return ok(client.get(f"/api/mortgages/{mortgage_id}"))


def parts(client, mortgage_id) -> list[tuple[str, bool, str | None]]:
    return [
        (i["on"], i["upcoming"], i["cancelled_on"])
        for i in mortgage(client, mortgage_id)["advance_instalments"]
    ]


def instalments_applied(shown) -> list[tuple[str, int]]:
    return [(s["on"], s["amount"]) for s in shown["ledger"] if s["instalment_id"]]


def redeem(client, mortgage_id) -> Any:
    return ok(
        client.post(
            f"/api/mortgages/{mortgage_id}/redeem",
            json={"redeemed_on": ON, "method": "cash"},
        )
    )


def reopen(client, mortgage_id) -> Any:
    return ok(
        client.post(f"/api/mortgages/{mortgage_id}/reopen", json={"reason": "Mistake"})
    )


def test_the_quote_shows_the_advance_held_and_what_is_left_to_pay(
    client, chain, advance
):
    quote = ok(
        client.get(
            f"/api/mortgages/{chain['id']}/outstanding-on-closure", params={"on": ON}
        )
    )

    assert (quote["total"], quote["advance_held"], quote["to_pay"]) == (
        1_03_000 * RUPEE,
        6_000 * RUPEE,
        97_000 * RUPEE,
    )


def test_redeeming_applies_every_upcoming_part_on_the_closure_date(
    client, chain, advance
):
    redeemed = redeem(client, chain["id"])

    assert instalments_applied(redeemed) == [
        ("2026-05-14", 3_000 * RUPEE),
        (ON, 3_000 * RUPEE),
        (ON, 3_000 * RUPEE),
    ]
    closure = redeemed["closure"]
    assert (
        closure["outstanding"],
        closure["advance_held"],
        closure["payment_amount"],
    ) == (1_03_000 * RUPEE, 6_000 * RUPEE, 97_000 * RUPEE)
    assert redeemed["outstanding"]["total"] == 0
    assert redeemed["advance_held"] == 0
    assert parts(client, chain["id"]) == [
        ("2026-05-14", False, None),
        ("2026-06-14", False, ON),
        ("2026-07-14", False, ON),
    ]
    # The final Payment comes after them.
    [final] = [
        s for s in redeemed["ledger"] if s["payment_id"] == closure["payment_id"]
    ]
    assert redeemed["ledger"][-1] == final


def test_a_part_the_closure_cancelled_has_a_receipt_on_the_closure_date(
    client, chain, advance
):
    redeem(client, chain["id"])
    [june] = [
        i
        for i in mortgage(client, chain["id"])["advance_instalments"]
        if i["on"] == "2026-06-14"
    ]

    shown = ok(
        client.get(
            f"/api/payments/{advance['id']}/advance-instalments/{june['id']}/receipt"
        )
    )

    assert (shown["paid_on"], shown["amount"], shown["advance_due_on"]) == (
        ON,
        3_000 * RUPEE,
        "2026-06-14",
    )


def test_a_closed_mortgage_is_listed_holding_nothing(client, ramesh, chain, advance):
    redeem(client, chain["id"])

    listed = ok(
        client.get(
            "/api/mortgages",
            params={"customer_id": ramesh["id"], "status": "redeemed", "as_of": ON},
        )
    )

    assert [row["advance_held"] for row in listed["items"]] == [0]


def test_waiving_applies_the_upcoming_parts_then_waives_what_is_left(
    client, chain, advance
):
    waived = ok(
        client.post(
            f"/api/mortgages/{chain['id']}/waive",
            json={"waived_on": ON, "amount_paid": 90_000 * RUPEE, "method": "cash"},
        )
    )

    assert instalments_applied(waived)[1:] == [(ON, 3_000 * RUPEE)] * 2
    closure = waived["closure"]
    assert (
        closure["advance_held"],
        closure["payment_amount"],
        closure["waived_amount"],
    ) == (6_000 * RUPEE, 90_000 * RUPEE, 7_000 * RUPEE)
    assert [upcoming for _, upcoming, _ in parts(client, chain["id"])] == [False] * 3


def test_a_waiver_paying_what_the_advance_leaves_is_a_redemption(
    client, chain, advance
):
    response = client.post(
        f"/api/mortgages/{chain['id']}/waive",
        json={"waived_on": ON, "amount_paid": 97_000 * RUPEE, "method": "cash"},
    )

    assert response.status_code == 422, response.text
    assert "Redeem it instead" in response.json()["detail"]


def test_forfeiting_applies_the_upcoming_parts_before_the_jewellery_settles_the_rest(
    client, chain, advance
):
    forfeited = ok(
        client.post(
            f"/api/mortgages/{chain['id']}/forfeit",
            json={"forfeited_on": ON, "recovered_amount": 1_00_000 * RUPEE},
        )
    )

    assert instalments_applied(forfeited)[1:] == [(ON, 3_000 * RUPEE)] * 2
    # It owed ₹1,03,000, the Advance held paid ₹6,000, the jewellery fetched ₹1,00,000.
    assert forfeited["closure"]["profit_loss"] == 3_000 * RUPEE
    assert forfeited["advance_held"] == 0


def test_bulk_closures_apply_each_mortgages_upcoming_parts(
    client, ramesh, chain, advance, clock
):
    clock.today = date(2026, 4, 20)
    ring = lend(client, ramesh, description="Gold ring")
    advance_on(client, ramesh, ring["id"])
    clock.today = date(2026, 5, 20)

    closed = ok(
        client.post(
            "/api/closures/redeem",
            json={
                "redeemed_on": ON,
                "method": "cash",
                "mortgage_ids": [chain["id"], ring["id"]],
            },
        )
    )

    for each in closed:
        assert each["closure"]["payment_amount"] == 97_000 * RUPEE
        assert instalments_applied(each)[1:] == [(ON, 3_000 * RUPEE)] * 2


def test_a_closure_owing_nothing_after_the_advance_needs_no_cash(
    client, ramesh, chain, clock
):
    # ₹1,12,000 held over 2 months on 20 Apr: all it owes then.
    response = client.post(
        "/api/payments",
        json={
            "customer_id": ramesh["id"],
            "paid_on": "2026-04-20",
            "amount": 1_12_000 * RUPEE,
            "method": "cash",
            "allocations": [
                {
                    "mortgage_id": chain["id"],
                    "amount": 0,
                    "advance": 1_12_000 * RUPEE,
                    "months": 2,
                }
            ],
        },
    )
    assert response.status_code == 201, response.text

    redeemed = ok(
        client.post(
            f"/api/mortgages/{chain['id']}/redeem",
            json={"redeemed_on": "2026-04-20", "method": "cash"},
        )
    )

    assert redeemed["closure"]["payment_id"] is None
    assert redeemed["outstanding"]["total"] == 0


def test_an_allocation_of_nothing_never_redeems_what_the_advance_covers(
    client, ramesh, chain
):
    ring = lend(client, ramesh, description="Gold ring")
    # The chain's ₹1,12,000 is all held on 20 Apr, so it has nothing left to pay.
    held = client.post(
        "/api/payments",
        json={
            "customer_id": ramesh["id"],
            "paid_on": "2026-04-20",
            "amount": 1_12_000 * RUPEE,
            "method": "cash",
            "allocations": [
                {
                    "mortgage_id": chain["id"],
                    "amount": 0,
                    "advance": 1_12_000 * RUPEE,
                    "months": 2,
                }
            ],
        },
    )
    assert held.status_code == 201, held.text

    paid = client.post(
        "/api/payments",
        json={
            "customer_id": ramesh["id"],
            "paid_on": "2026-04-20",
            "amount": 1_000 * RUPEE,
            "method": "cash",
            "allocations": [
                {"mortgage_id": chain["id"], "amount": 0},
                {"mortgage_id": ring["id"], "amount": 1_000 * RUPEE},
            ],
        },
    )

    assert paid.status_code == 201, paid.text
    assert mortgage(client, chain["id"])["status"] == "active"


def test_reopening_restores_exactly_the_parts_the_closure_cancelled(
    client, chain, advance, clock
):
    clock.today = date(2026, 5, 20)
    cancelled = client.post(
        f"/api/mortgages/{chain['id']}/advance-instalments/"
        f"{mortgage(client, chain['id'])['advance_instalments'][1]['id']}/cancel"
    )
    assert cancelled.status_code == 200, cancelled.text
    redeem(client, chain["id"])

    reopened = reopen(client, chain["id"])

    assert parts(client, chain["id"]) == [
        ("2026-05-14", False, None),
        ("2026-06-14", False, ON),  # cancelled by the Lender, before the Closure
        ("2026-07-14", True, None),
    ]
    assert reopened["advance_held"] == 3_000 * RUPEE
    assert instalments_applied(reopened) == [
        ("2026-05-14", 3_000 * RUPEE),
        (ON, 3_000 * RUPEE),
    ]
    assert reopened["outstanding"]["total"] == 1_00_000 * RUPEE


def test_a_payment_of_what_the_advance_leaves_redeems_it(
    client, ramesh, chain, advance
):
    response = client.post(
        "/api/payments",
        json={
            "customer_id": ramesh["id"],
            "paid_on": ON,
            "amount": 97_000 * RUPEE,
            "method": "cash",
            "allocations": [{"mortgage_id": chain["id"], "amount": 97_000 * RUPEE}],
        },
    )

    assert response.status_code == 201, response.text
    redeemed = mortgage(client, chain["id"])
    assert redeemed["status"] == "redeemed"
    assert redeemed["closure"]["advance_held"] == 6_000 * RUPEE
