"""An Advance after saving (ADR 0021): its parts on the Mortgage page, what is held, and
cancelling an upcoming part, which applies its amount at once on the cancel date.

The Mortgage is ₹1,00,000 at 3% Simple from 14 Jan 2026 (₹3,000 a month, a full month
charged as the Interest to Date). On 20 Apr 2026 ₹9,000 is paid now and an Advance of
₹9,000 over 3 months, landing on 14 May, 14 Jun and 14 Jul. The tests look on 20 May,
when the 14 May part is applied and the other two are upcoming."""

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


def pay(client, ramesh, rows: dict[int, tuple[int, int, int]]) -> Any:
    """Record a Payment today: `rows` is (pay now, Advance, months) by Mortgage id."""
    response = client.post(
        "/api/payments",
        json={
            "customer_id": ramesh["id"],
            "paid_on": "2026-04-20",
            "amount": sum(now + advance for now, advance, _ in rows.values()),
            "method": "cash",
            "allocations": [
                {"mortgage_id": id_, "amount": now, "advance": advance, "months": n}
                for id_, (now, advance, n) in rows.items()
            ],
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


@pytest.fixture
def advance(client, ramesh, chain, clock):
    """The Payment with the Advance, seen on 20 May."""
    payment = pay(client, ramesh, {chain["id"]: (9_000 * RUPEE, 9_000 * RUPEE, 3)})
    clock.today = date(2026, 5, 20)
    return payment


def get(client, path, **params):
    response = client.get(path, params=params)
    assert response.status_code == 200, response.text
    return response.json()


def mortgage(client, mortgage_id):
    return get(client, f"/api/mortgages/{mortgage_id}")


def part(client, mortgage_id, on: str) -> Any:
    [found] = [
        i for i in mortgage(client, mortgage_id)["advance_instalments"] if i["on"] == on
    ]
    return found


def cancel_path(mortgage_id: int, instalment_id: int) -> str:
    return f"/api/mortgages/{mortgage_id}/advance-instalments/{instalment_id}/cancel"


def cancel(client, mortgage_id: int, on: str) -> Any:
    response = client.post(
        cancel_path(mortgage_id, part(client, mortgage_id, on)["id"])
    )
    assert response.status_code == 200, response.text
    return response.json()


def test_the_mortgage_shows_each_part_and_the_advance_held(client, chain, advance):
    shown = mortgage(client, chain["id"])

    assert [
        (i["on"], i["amount"], i["number"], i["of"], i["upcoming"], i["cancelled_on"])
        for i in shown["advance_instalments"]
    ] == [
        ("2026-05-14", 3_000 * RUPEE, 1, 3, False, None),
        ("2026-06-14", 3_000 * RUPEE, 2, 3, True, None),
        ("2026-07-14", 3_000 * RUPEE, 3, 3, True, None),
    ]
    assert {i["received_on"] for i in shown["advance_instalments"]} == {"2026-04-20"}
    assert shown["advance_held"] == 6_000 * RUPEE


def test_cancelling_an_upcoming_part_applies_it_at_once(client, chain, advance):
    # 20 May: the Interest to Date from 14 May is ₹3,000.
    assert mortgage(client, chain["id"])["outstanding"]["total"] == 1_03_000 * RUPEE

    cancelled = cancel(client, chain["id"], "2026-06-14")

    [applied] = [
        s for s in cancelled["ledger"] if s["instalment_id"] and s["on"] == "2026-05-20"
    ]
    assert (applied["amount"], applied["interest_paid"], applied["principal_paid"]) == (
        3_000 * RUPEE,
        3_000 * RUPEE,
        0,
    )
    assert cancelled["outstanding"]["total"] == LAKH
    assert cancelled["advance_held"] == 3_000 * RUPEE
    shown = part(client, chain["id"], "2026-06-14")
    assert (shown["upcoming"], shown["cancelled_on"]) == (False, "2026-05-20")


def test_a_cancelled_part_is_not_applied_on_its_own_date(client, chain, advance, clock):
    cancel(client, chain["id"], "2026-06-14")
    clock.today = date(2026, 6, 20)

    applied_on = [
        s["on"] for s in mortgage(client, chain["id"])["ledger"] if s["instalment_id"]
    ]

    assert applied_on == ["2026-05-14", "2026-05-20"]


def test_the_preview_shows_the_cancel_without_saving_it(client, chain, advance):
    instalment = part(client, chain["id"], "2026-06-14")

    response = client.post(
        cancel_path(chain["id"], instalment["id"]).replace("/cancel", "/cancel-preview")
    )

    assert response.status_code == 200, response.text
    [previewed] = response.json()["mortgages"]
    assert (previewed["before"]["outstanding"], previewed["after"]["outstanding"]) == (
        1_03_000 * RUPEE,
        LAKH,
    )
    [change] = [c for c in previewed["ledger_changes"] if c["event"] == "payment"]
    assert change["before"] is None
    assert change["after"]["instalment_id"] == instalment["id"]
    assert part(client, chain["id"], "2026-06-14")["cancelled_on"] is None


def test_the_preview_tells_a_part_cancelled_on_the_day_received_from_the_payment(
    client, ramesh, chain
):
    pay(client, ramesh, {chain["id"]: (9_000 * RUPEE, 9_000 * RUPEE, 3)})
    instalment = part(client, chain["id"], "2026-05-14")

    response = client.post(
        cancel_path(chain["id"], instalment["id"]).replace("/cancel", "/cancel-preview")
    )

    assert response.status_code == 200, response.text
    [change] = [
        c
        for c in response.json()["mortgages"][0]["ledger_changes"]
        if c["event"] == "payment"
    ]
    assert (change["on"], change["before"]) == ("2026-04-20", None)
    assert change["after"]["instalment_id"] == instalment["id"]


@pytest.mark.parametrize("path", ["/cancel", "/cancel-preview"])
@pytest.mark.parametrize(
    ("on", "refusal"),
    [
        ("2026-05-14", "has been applied"),
        ("2026-06-14", "was cancelled on 20 May 2026"),
    ],
)
def test_only_an_upcoming_part_can_be_cancelled(
    client, chain, advance, path, on, refusal
):
    cancel(client, chain["id"], "2026-06-14")
    instalment = part(client, chain["id"], on)

    response = client.post(
        cancel_path(chain["id"], instalment["id"]).replace("/cancel", path)
    )

    assert response.status_code == 409, response.text
    assert refusal in response.json()["detail"]


@pytest.mark.parametrize("path", ["/cancel", "/cancel-preview"])
def test_a_part_of_another_mortgage_is_not_found(client, ramesh, chain, advance, path):
    ring = lend(client, ramesh, description="Gold ring")
    instalment = part(client, chain["id"], "2026-06-14")

    response = client.post(
        cancel_path(ring["id"], instalment["id"]).replace("/cancel", path)
    )

    assert response.status_code == 404, response.text


def test_a_cancel_is_recorded_in_history(client, chain, advance):
    cancel(client, chain["id"], "2026-06-14")

    [newest] = get(client, f"/api/mortgages/{chain['id']}/history")["items"][0]

    assert newest["action"] == "advance_instalment_cancelled"
    assert newest["note"] == "2 of 3, ₹3,000 due 14 Jun 2026"


def test_the_payments_list_tags_an_advance_with_its_upcoming_parts(
    client, ramesh, chain, advance
):
    ring = lend(client, ramesh, description="Gold ring")
    pay(client, ramesh, {ring["id"]: (1_000 * RUPEE, 0, 1)})

    def tags():
        return [p["advance"] for p in get(client, "/api/payments")["items"]]

    assert tags() == [None, {"upcoming": 2, "of": 3}]
    cancel(client, chain["id"], "2026-06-14")
    assert tags() == [None, {"upcoming": 1, "of": 3}]


def test_the_customer_shows_the_advance_held_across_their_mortgages(
    client, ramesh, chain, clock
):
    ring = lend(client, ramesh, start="2026-02-28", description="Gold ring")
    pay(
        client,
        ramesh,
        {chain["id"]: (0, 6_000 * RUPEE, 2), ring["id"]: (0, 600 * RUPEE, 2)},
    )

    def held():
        return get(client, f"/api/customers/{ramesh['id']}")["advance_held"]

    assert held() == 6_600 * RUPEE
    cancel(client, chain["id"], "2026-06-14")
    assert held() == 3_600 * RUPEE


def test_voiding_the_payment_removes_cancelled_parts_too(client, chain, advance):
    cancel(client, chain["id"], "2026-06-14")

    voided = client.post(
        f"/api/payments/{advance['id']}/void", json={"reason": "Entered by mistake"}
    )

    assert voided.status_code == 200, voided.text
    after = mortgage(client, chain["id"])
    assert after["advance_instalments"] == []
    assert after["advance_held"] == 0
    assert not [s for s in after["ledger"] if s["payment_id"]]
