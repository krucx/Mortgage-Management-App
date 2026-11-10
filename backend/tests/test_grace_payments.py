"""A Grace Payment (see the Grace Period in Documentation/GLOSSARY.md, ADR 0020): received
within the Grace Period after an Accrual Date and dated the day before it, keeping the
date it was received and, for each Mortgage, the amount the earlier date let off.

The Mortgages are ₹1,00,000 at 3% Simple from 14 Jan 2026 (₹3,000 a month, a full month
charged on redemption) unless said otherwise; today (conftest) is 20 Apr 2026."""

import pytest
from api_seed import lend, pay, person
from seed import LAKH


@pytest.fixture
def ramesh(client):
    return person(client)


@pytest.fixture
def chain(client, ramesh):
    return lend(client, ramesh)


def set_grace_period(client, days):
    response = client.put("/api/settings/grace-period", json={"grace_period_days": days})
    assert response.status_code == 200, response.text


def draft(ramesh, allocations, on, **fields):
    """A Payment as New Payment drafts it: `allocations` is cash by Mortgage id."""
    return {
        "customer_id": ramesh["id"],
        "paid_on": on,
        "amount": sum(allocations.values()),
        "method": "cash",
        "allocations": [
            {"mortgage_id": mortgage_id, "amount": amount}
            for mortgage_id, amount in allocations.items()
        ],
        **fields,
    }


def offer(client, payment):
    response = client.post("/api/payments/grace-offer", json=payment)
    assert response.status_code == 200, response.text
    return response.json()


def test_principal_paid_just_after_an_accrual_date_is_offered_the_day_before(
    client, ramesh, chain
):
    # ₹20,000 on 15 Apr pays ₹9,000 interest, the new month's ₹3,000 and ₹8,000
    # Principal; dated 13 Apr it pays ₹6,000 and ₹3,000, so ₹11,000 Principal a month
    # earlier: the month from 14 Apr is charged on ₹89,000, not ₹1,00,000 (ADR 0006).
    set_grace_period(client, 2)

    assert offer(client, draft(ramesh, {chain["id"]: 20_000_00}, "2026-04-15")) == {
        "days": 2,
        "accrual_on": "2026-04-14",
        "paid_on": "2026-04-13",
        "let_off": 330_00,
        "mortgages": [{"mortgage_id": chain["id"], "let_off": 330_00}],
    }


def test_nothing_is_offered_when_the_earlier_date_saves_nothing(client, ramesh, chain):
    # Interest only, Simple, either way (₹9,000 is all the interest owed on 13 Apr):
    # ₹1,03,000 is owed on 15 Apr whichever date it has.
    set_grace_period(client, 2)

    assert offer(client, draft(ramesh, {chain["id"]: 9_000_00}, "2026-04-15")) is None


def test_nothing_is_offered_with_the_grace_period_off(client, ramesh, chain):
    assert offer(client, draft(ramesh, {chain["id"]: 20_000_00}, "2026-04-15")) is None


def test_nothing_is_offered_after_the_grace_period(client, ramesh, chain):
    set_grace_period(client, 2)

    assert offer(client, draft(ramesh, {chain["id"]: 20_000_00}, "2026-04-17")) is None


def test_the_last_day_of_the_grace_period_is_within_it(client, ramesh, chain):
    set_grace_period(client, 2)

    found = offer(client, draft(ramesh, {chain["id"]: 20_000_00}, "2026-04-16"))

    assert (found["accrual_on"], found["paid_on"]) == ("2026-04-14", "2026-04-13")


def test_the_start_date_is_not_an_accrual_date(client, ramesh):
    set_grace_period(client, 2)
    new = lend(client, ramesh, start="2026-04-14", name="2026-Ramesh-Ring")

    assert offer(client, draft(ramesh, {new["id"]: 20_000_00}, "2026-04-15")) is None


def test_the_accrual_date_is_after_month_end_clamping(client, ramesh):
    # Started 31 Oct 2025, so its Accrual Date in November is the 30th.
    set_grace_period(client, 2)
    month_end = lend(client, ramesh, start="2025-10-31", name="2025-Ramesh-Ring")

    found = offer(client, draft(ramesh, {month_end["id"]: 20_000_00}, "2025-12-01"))

    assert (found["accrual_on"], found["paid_on"]) == ("2025-11-30", "2025-11-29")


def test_with_several_mortgages_it_is_the_day_before_the_earliest_accrual_date_and_the_saving_is_summed(
    client, ramesh, chain
):
    # The bangle's Accrual Date is 15 Apr; the chain's, 14 Apr, is earlier. Each pays
    # ₹11,000 of Principal a month earlier dated 13 Apr: ₹330 each.
    set_grace_period(client, 2)
    bangle = lend(client, ramesh, start="2026-01-15", name="2026-Ramesh-Bangle")

    found = offer(
        client,
        draft(ramesh, {chain["id"]: 20_000_00, bangle["id"]: 20_000_00}, "2026-04-16"),
    )

    assert found["paid_on"] == "2026-04-13"
    assert found["mortgages"] == [
        {"mortgage_id": chain["id"], "let_off": 330_00},
        {"mortgage_id": bangle["id"], "let_off": 330_00},
    ]
    assert found["let_off"] == 660_00


def test_nothing_is_offered_when_a_mortgage_started_after_the_earlier_date(
    client, ramesh, chain
):
    set_grace_period(client, 2)
    ring = lend(client, ramesh, start="2026-04-14", name="2026-Ramesh-Ring")

    assert (
        offer(
            client,
            draft(ramesh, {chain["id"]: 20_000_00, ring["id"]: 1_000_00}, "2026-04-15"),
        )
        is None
    )


def test_paying_in_full_just_after_an_accrual_date_is_offered_the_new_month(
    client, ramesh, chain
):
    # ₹1,12,000 is owed on 15 Apr with the month from 14 Apr; ₹1,09,000 on 13 Apr.
    set_grace_period(client, 2)

    found = offer(client, draft(ramesh, {chain["id"]: 1_12_000_00}, "2026-04-15"))

    assert (found["paid_on"], found["let_off"]) == ("2026-04-13", 3_000_00)


def test_a_grace_payment_keeps_its_received_date_and_the_amount_let_off(
    client, ramesh, chain
):
    set_grace_period(client, 2)

    payment = pay(
        client, ramesh, {chain["id"]: 20_000_00}, on="2026-04-13", received_on="2026-04-15"
    )

    saved = client.get(f"/api/payments/{payment['id']}").json()
    assert (saved["paid_on"], saved["received_on"]) == ("2026-04-13", "2026-04-15")
    assert [a["let_off"] for a in saved["allocations"]] == [330_00]


def test_an_ordinary_back_dated_payment_keeps_neither(client, ramesh, chain):
    set_grace_period(client, 2)

    payment = pay(client, ramesh, {chain["id"]: 20_000_00}, on="2026-04-13")

    assert payment["received_on"] is None
    assert [a["let_off"] for a in payment["allocations"]] == [None]


@pytest.mark.parametrize(
    ("days", "paid_on", "received_on"),
    [
        (2, "2026-04-13", "2026-04-17"),  # after the Grace Period
        (2, "2026-04-12", "2026-04-15"),  # not the day before the Accrual Date
        (None, "2026-04-13", "2026-04-15"),  # the Grace Period is off
        (10, "2026-04-13", "2026-04-21"),  # within it, but received tomorrow
    ],
)
def test_a_grace_payment_outside_the_grace_period_is_refused(
    client, ramesh, chain, days, paid_on, received_on
):
    set_grace_period(client, days)

    response = client.post(
        "/api/payments",
        json=draft(ramesh, {chain["id"]: 20_000_00}, paid_on, received_on=received_on),
    )

    assert response.status_code == 422, response.text
    assert client.get("/api/payments").json()["items"] == []


def test_a_grace_payment_is_judged_by_the_grace_period_as_set_when_it_is_saved(
    client, ramesh, chain
):
    set_grace_period(client, 2)
    payment = pay(
        client, ramesh, {chain["id"]: 20_000_00}, on="2026-04-13", received_on="2026-04-15"
    )

    set_grace_period(client, None)

    saved = client.get(f"/api/payments/{payment['id']}").json()
    assert (saved["received_on"], saved["allocations"][0]["let_off"]) == (
        "2026-04-15",
        330_00,
    )


def test_a_redeeming_grace_payment_lets_off_the_new_month_and_its_final_payment_has_the_earlier_date(
    client, ramesh, chain
):
    set_grace_period(client, 2)

    payment = pay(
        client, ramesh, {chain["id"]: 1_09_000_00}, on="2026-04-13", received_on="2026-04-15"
    )

    closure = client.get(f"/api/mortgages/{chain['id']}").json()["closure"]
    assert (closure["kind"], closure["on"], closure["payment_id"]) == (
        "redeemed",
        "2026-04-13",
        payment["id"],
    )
    assert (payment["paid_on"], payment["received_on"]) == ("2026-04-13", "2026-04-15")
    assert [a["let_off"] for a in payment["allocations"]] == [3_000_00]


def test_a_grace_payment_paying_one_mortgage_and_redeeming_another_keeps_both_amounts(
    client, ramesh, chain
):
    set_grace_period(client, 2)
    bangle = lend(client, ramesh, start="2026-01-15", name="2026-Ramesh-Bangle")

    first = pay(
        client,
        ramesh,
        {chain["id"]: 20_000_00, bangle["id"]: 1_09_000_00},
        on="2026-04-13",
        received_on="2026-04-16",
    )

    final_id = client.get(f"/api/mortgages/{bangle['id']}").json()["closure"]["payment_id"]
    final = client.get(f"/api/payments/{final_id}").json()
    assert [a["let_off"] for a in first["allocations"]] == [330_00]
    assert (final["paid_on"], final["received_on"]) == ("2026-04-13", "2026-04-16")
    assert [a["let_off"] for a in final["allocations"]] == [3_000_00]


def test_a_grace_payment_can_be_voided_like_any_other(client, ramesh, chain):
    set_grace_period(client, 2)
    payment = pay(
        client, ramesh, {chain["id"]: 20_000_00}, on="2026-04-13", received_on="2026-04-15"
    )

    response = client.post(f"/api/payments/{payment['id']}/void", json={"reason": "Twice"})

    assert response.status_code == 200, response.text
    assert response.json()["voided_at"] is not None
    owed = client.get(f"/api/mortgages/{chain['id']}").json()["outstanding"]["total"]
    assert owed == LAKH + 12_000_00
