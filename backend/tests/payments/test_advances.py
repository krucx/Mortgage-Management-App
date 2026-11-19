"""Advances (see Advance and Advance Instalment in Documentation/GLOSSARY.md, ADR 0021):
part of a Payment held for a Mortgage's interest for its next few months, split into
Advance Instalments applied on its next Accrual Dates after the date received.

The Mortgage is ₹1,00,000 at 3% Simple from 14 Jan 2026 (₹3,000 a month, a full month
charged as the Interest to Date) unless said otherwise. On 20 Apr 2026 it has ₹9,000 of
interest unpaid (14 Feb, 14 Mar and 14 Apr) and owes ₹1,12,000 with the Interest to
Date."""

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


def draft(
    ramesh: Any, rows: dict[int, tuple[int, int, int]], on: str = "2026-04-20", **fields
) -> dict[str, Any]:
    """A Payment as New Payment drafts it: `rows` is (pay now, Advance, months) by
    Mortgage id; Amount received is all of it."""
    return {
        "customer_id": ramesh["id"],
        "paid_on": on,
        "amount": sum(now + advance for now, advance, _ in rows.values()),
        "method": "cash",
        "allocations": [
            {"mortgage_id": mortgage_id, "amount": now, "advance": advance, "months": n}
            for mortgage_id, (now, advance, n) in rows.items()
        ],
        **fields,
    }


def record(client, payment):
    response = client.post("/api/payments", json=payment)
    assert response.status_code == 201, response.text
    return response.json()


def preview(client, payment):
    response = client.post("/api/payments/preview", json=payment)
    assert response.status_code == 200, response.text
    return response.json()


def mortgage(client, mortgage_id):
    response = client.get(f"/api/mortgages/{mortgage_id}")
    assert response.status_code == 200, response.text
    return response.json()


def instalments(client, mortgage_id):
    """The Mortgage's Advance Instalments: (date, amount, upcoming)."""
    return [
        (i["on"], i["amount"], i["upcoming"])
        for i in mortgage(client, mortgage_id)["advance_instalments"]
    ]


def test_an_advance_is_split_over_the_next_accrual_dates_with_the_remainder_last(
    client, ramesh, chain
):
    record(client, draft(ramesh, {chain["id"]: (9_000 * RUPEE, 10_000 * RUPEE, 3)}))

    assert instalments(client, chain["id"]) == [
        ("2026-05-14", 3_333_33, True),
        ("2026-06-14", 3_333_33, True),
        ("2026-07-14", 3_333_34, True),
    ]


def test_received_on_an_accrual_date_the_first_part_lands_on_the_next(
    client, ramesh, chain, clock
):
    clock.today = date(2026, 4, 14)
    record(
        client,
        draft(ramesh, {chain["id"]: (0, 6_000 * RUPEE, 2)}, on="2026-04-14"),
    )

    assert [on for on, _, _ in instalments(client, chain["id"])] == [
        "2026-05-14",
        "2026-06-14",
    ]


def test_each_mortgage_is_split_over_its_own_accrual_dates(client, ramesh, chain):
    ring = lend(client, ramesh, start="2026-02-28", description="Gold ring")
    record(
        client,
        draft(
            ramesh,
            {
                chain["id"]: (0, 6_000 * RUPEE, 2),
                ring["id"]: (0, 3_000 * RUPEE, 1),
            },
        ),
    )

    assert [on for on, _, _ in instalments(client, chain["id"])] == [
        "2026-05-14",
        "2026-06-14",
    ]
    assert [on for on, _, _ in instalments(client, ring["id"])] == ["2026-04-28"]


def test_the_payment_is_one_payment_of_everything_received(client, ramesh, chain):
    payment = record(
        client, draft(ramesh, {chain["id"]: (9_000 * RUPEE, 9_000 * RUPEE, 3)})
    )

    assert payment["amount"] == 18_000 * RUPEE
    [allocation] = payment["allocations"]
    assert (allocation["amount"], allocation["advance"]) == (
        9_000 * RUPEE,
        9_000 * RUPEE,
    )


def test_upcoming_parts_leave_today_untouched_and_land_on_their_dates(
    client, ramesh, chain, clock
):
    record(client, draft(ramesh, {chain["id"]: (9_000 * RUPEE, 9_000 * RUPEE, 3)}))

    # Before the parts: only the ₹9,000 paid now counts.
    today = mortgage(client, chain["id"])
    assert today["outstanding"]["total"] == 1_03_000 * RUPEE
    assert not [s for s in today["ledger"] if s["instalment_id"]]

    # Between them: the 14 May part has paid that month's interest.
    clock.today = date(2026, 5, 20)
    between = mortgage(client, chain["id"])
    assert between["outstanding"]["total"] == 1_03_000 * RUPEE
    [applied] = [s for s in between["ledger"] if s["instalment_id"]]
    assert (applied["on"], applied["interest_paid"], applied["principal_paid"]) == (
        "2026-05-14",
        3_000 * RUPEE,
        0,
    )
    assert [upcoming for _, _, upcoming in instalments(client, chain["id"])] == [
        False,
        True,
        True,
    ]

    # After them all: every month's interest paid, Principal untouched.
    clock.today = date(2026, 7, 20)
    after = mortgage(client, chain["id"])
    assert after["outstanding"] == {
        "principal": LAKH,
        "unpaid_interest": 3_000 * RUPEE,  # the Interest to Date from 14 Jul
        "total": 1_03_000 * RUPEE,
    }
    assert len([s for s in after["ledger"] if s["instalment_id"]]) == 3


def test_upcoming_parts_never_stop_a_closure_today(client, ramesh, chain):
    record(client, draft(ramesh, {chain["id"]: (9_000 * RUPEE, 9_000 * RUPEE, 3)}))

    response = client.get("/api/mortgages", params={"customer_id": ramesh["id"]})
    assert response.status_code == 200, response.text
    [row] = response.json()["items"]
    assert row["not_redeemable"] is None


def test_the_payment_shows_how_today_s_part_was_applied(client, ramesh, chain, clock):
    payment = record(
        client, draft(ramesh, {chain["id"]: (9_000 * RUPEE, 9_000 * RUPEE, 3)})
    )
    clock.today = date(2026, 7, 20)

    response = client.get(f"/api/payments/{payment['id']}")
    assert response.status_code == 200, response.text
    [allocation] = response.json()["allocations"]
    assert (allocation["interest_paid"], allocation["principal_paid"]) == (
        9_000 * RUPEE,
        0,
    )


def test_voiding_the_payment_removes_every_part(client, ramesh, chain, clock):
    payment = record(
        client, draft(ramesh, {chain["id"]: (9_000 * RUPEE, 9_000 * RUPEE, 3)})
    )
    clock.today = date(2026, 5, 20)

    voided = client.post(
        f"/api/payments/{payment['id']}/void", json={"reason": "Entered by mistake"}
    )

    assert voided.status_code == 200, voided.text
    assert instalments(client, chain["id"]) == []
    after = mortgage(client, chain["id"])
    assert not [s for s in after["ledger"] if s["payment_id"]]
    # 14 Feb to 14 May unpaid, and the Interest to Date from 14 May.
    assert after["outstanding"]["total"] == 1_15_000 * RUPEE


@pytest.mark.parametrize(
    ("advance", "verdict"),
    [
        (9_000 * RUPEE, "exact"),
        (6_000 * RUPEE, "falls_short"),
        (30_000 * RUPEE, "reduces_principal"),
    ],
)
def test_the_preview_schedules_each_part_with_a_verdict(
    client, ramesh, chain, advance, verdict
):
    previewed = preview(
        client, draft(ramesh, {chain["id"]: (9_000 * RUPEE, advance, 3)})
    )

    [schedule] = [m["advance"] for m in previewed["mortgages"]]
    assert schedule["verdict"] == verdict
    assert [part["on"] for part in schedule["parts"]] == [
        "2026-05-14",
        "2026-06-14",
        "2026-07-14",
    ]


def test_the_preview_shows_what_each_part_pays(client, ramesh, chain):
    previewed = preview(
        client, draft(ramesh, {chain["id"]: (9_000 * RUPEE, 30_000 * RUPEE, 3)})
    )

    [first, second, _] = previewed["mortgages"][0]["advance"]["parts"]
    # 14 May: that month's ₹3,000, then the new month's ₹3,000 ahead, then Principal.
    assert first == {
        "on": "2026-05-14",
        "amount": 10_000 * RUPEE,
        "interest": 3_000 * RUPEE,
        "interest_paid": 6_000 * RUPEE,
        "principal_paid": 4_000 * RUPEE,
        "principal_after": 96_000 * RUPEE,
        "unpaid_interest_after": 0,
    }
    # 14 Jun: the month's interest was paid ahead; the new month's is on ₹96,000.
    assert (second["interest"], second["interest_paid"], second["principal_paid"]) == (
        3_000 * RUPEE,
        2_880 * RUPEE,
        7_120 * RUPEE,
    )


def test_an_advance_holding_more_than_the_outstanding_is_refused(client, ramesh, chain):
    # Owing ₹1,12,000, less ₹9,000 paid now and ₹1,000 Discount: ₹1,02,000 fits.
    too_much = draft(ramesh, {chain["id"]: (9_000 * RUPEE, 1_02_000 * RUPEE + 1, 3)})
    too_much["allocations"][0]["discount"] = 1_000 * RUPEE

    for path in ("/api/payments/preview", "/api/payments"):
        response = client.post(path, json=too_much)
        assert response.status_code == 422, response.text
        assert chain["name"] in response.json()["detail"]
        assert "₹1,02,000" in response.json()["detail"]

    fits = draft(ramesh, {chain["id"]: (9_000 * RUPEE, 1_02_000 * RUPEE, 3)})
    fits["allocations"][0]["discount"] = 1_000 * RUPEE
    record(client, fits)


def test_a_grace_payment_schedules_its_advance_from_the_date_received(
    client, ramesh, chain, clock
):
    response = client.put("/api/settings/grace-period", json={"grace_period_days": 2})
    assert response.status_code == 200, response.text
    clock.today = date(2026, 4, 15)

    # Dated 13 Apr, the day before an Accrual Date, but received on 15 Apr.
    record(
        client,
        draft(
            ramesh,
            {chain["id"]: (20_000 * RUPEE, 3_000 * RUPEE, 1)},
            on="2026-04-13",
            received_on="2026-04-15",
        ),
    )

    assert instalments(client, chain["id"]) == [("2026-05-14", 3_000 * RUPEE, True)]


@pytest.mark.parametrize("months", [0, 13])
def test_an_advance_is_over_one_to_twelve_months(client, ramesh, chain, months):
    response = client.post(
        "/api/payments",
        json=draft(ramesh, {chain["id"]: (0, 3_000 * RUPEE, months)}),
    )

    assert response.status_code == 422, response.text
