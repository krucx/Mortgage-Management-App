"""A Payment that redeems: an Allocation of a Mortgage's whole Outstanding, on the
Payment date, closes it with that Allocation as its final Payment; the rest of the
Payment, if any, is ordinary, and all of it is recorded or none."""

import pytest
from api_seed import SIMPLE_3, lend, pay, person
from seed import LAKH

# 20 Apr 2026, for a Mortgage of ₹1 lakh from 14 Jan at 3% (full-month Part-Month
# Rule): ₹9,000 accrued, plus ₹3,000 for the part-month.
ON = "2026-04-20"
OUTSTANDING = LAKH + 12_000_00


@pytest.fixture
def ramesh(client):
    return person(client)


@pytest.fixture
def chain(client, ramesh):
    return lend(client, ramesh)


def mortgage(client, m):
    response = client.get(f"/api/mortgages/{m['id']}")
    assert response.status_code == 200, response.text
    return response.json()


def test_a_payment_of_the_whole_outstanding_redeems_the_mortgage_on_its_date(
    client, ramesh, chain
):
    payment = pay(
        client, ramesh, {chain["id"]: OUTSTANDING}, on=ON, redeeming=[chain["id"]]
    )

    closure = mortgage(client, chain)["closure"]
    assert (closure["kind"], closure["on"], closure["payment_amount"]) == (
        "redeemed",
        ON,
        OUTSTANDING,
    )
    assert closure["payment_id"] == payment["id"]


def test_the_outstanding_listed_for_a_back_dated_payment_is_what_redeems_it(
    client, ramesh
):
    # Pro-rata, part-paid on 15 Feb, and paid in full on 5 Mar: New Payment offers
    # each Mortgage's listed Outstanding on the Payment date as the amount that Redeems.
    pro_rata = lend(client, ramesh, terms={**SIMPLE_3, "part_month_rule": "pro_rata"})
    pay(client, ramesh, {pro_rata["id"]: 20_000_00}, on="2026-02-15")
    listed = client.get(
        "/api/mortgages",
        params={"customer_id": ramesh["id"], "status": "active", "as_of": "2026-03-05"},
    ).json()["items"]
    owed = next(m["outstanding_total"] for m in listed if m["id"] == pro_rata["id"])

    pay(client, ramesh, {pro_rata["id"]: owed}, on="2026-03-05", redeeming=[pro_rata["id"]])

    redeemed = mortgage(client, pro_rata)
    assert (redeemed["status"], redeemed["closure"]["outstanding"]) == ("redeemed", owed)
    assert redeemed["outstanding"]["total"] == 0


def payment_of(ramesh, allocations, **fields):
    return {
        "customer_id": ramesh["id"],
        "paid_on": ON,
        "amount": sum(allocations.values()),
        "method": "upi",
        "reference": "UTR9",
        "allocations": [{"mortgage_id": m, "amount": a} for m, a in allocations.items()],
        **fields,
    }


def payments(client):
    return client.get("/api/payments").json()["items"]


def test_an_amount_other_than_the_outstanding_is_refused_and_nothing_recorded(
    client, ramesh, chain
):
    asked = payment_of(ramesh, {chain["id"]: LAKH}, redeeming=[chain["id"]])

    response = client.post("/api/payments", json=asked)

    assert response.status_code == 422
    assert response.json()["detail"] == (
        f"{chain['name']}: ₹1,00,000 is not its Outstanding on 20 Apr 2026 "
        "(₹1,12,000)"
    )
    assert payments(client) == []
    assert mortgage(client, chain)["status"] == "active"


@pytest.fixture
def ring(client, ramesh):
    return lend(client, ramesh, description="Gold ring", amount=50_000_00)


def test_one_payment_can_redeem_one_mortgage_and_part_pay_another(
    client, ramesh, chain, ring
):
    asked = payment_of(
        ramesh, {chain["id"]: OUTSTANDING, ring["id"]: 8_000_00}, redeeming=[chain["id"]]
    )

    response = client.post("/api/payments", json=asked)

    assert response.status_code == 201, response.text
    assert mortgage(client, chain)["status"] == "redeemed"
    # ₹1,500 charged on each of three Accrual Dates, and as the Interest to Date
    assert mortgage(client, ring)["outstanding"]["total"] == 50_000_00 + 6_000_00 - 8_000_00
    recorded = sorted((p["amount"], p["method"], p["reference"]) for p in payments(client))
    assert recorded == [(8_000_00, "upi", "UTR9"), (OUTSTANDING, "upi", "UTR9")]


def test_if_the_redemption_is_refused_the_ordinary_part_is_not_recorded_either(
    client, ramesh, chain, ring
):
    asked = payment_of(
        ramesh, {chain["id"]: LAKH, ring["id"]: 8_000_00}, redeeming=[chain["id"]]
    )

    assert client.post("/api/payments", json=asked).status_code == 422
    assert payments(client) == []


def test_reopening_the_redeemed_mortgage_voids_only_its_final_payment(
    client, ramesh, chain, ring
):
    pay(
        client,
        ramesh,
        {chain["id"]: OUTSTANDING, ring["id"]: 8_000_00},
        on=ON,
        redeeming=[chain["id"]],
    )

    response = client.post(
        f"/api/mortgages/{chain['id']}/reopen", json={"reason": "Recorded by mistake"}
    )

    assert response.status_code == 200, response.text
    left = [(p["amount"], p["voided"]) for p in payments(client)]
    assert sorted(left) == [(8_000_00, False), (OUTSTANDING, True)]


def test_the_preview_of_a_payment_that_redeems_shows_the_redemption_and_saves_nothing(
    client, ramesh, chain
):
    asked = payment_of(ramesh, {chain["id"]: OUTSTANDING}, redeeming=[chain["id"]])

    response = client.post("/api/payments/preview", json=asked)

    assert response.status_code == 200, response.text
    [preview] = response.json()
    assert preview["after"]["closure"]["kind"] == "redeemed"
    assert payments(client) == []


# --- Its Receipt: one for everything handed over, whichever of its Payments it's opened from.


def receipt(client, payment_id):
    response = client.get(f"/api/payments/{payment_id}/receipt")
    assert response.status_code == 200, response.text
    return response.json()


def test_a_payment_that_redeems_and_part_pays_has_one_receipt_for_all_of_it(
    client, ramesh, chain, ring
):
    pay(
        client,
        ramesh,
        {chain["id"]: OUTSTANDING, ring["id"]: 8_000_00},
        on=ON,
        redeeming=[chain["id"]],
    )
    ids = [p["id"] for p in payments(client)]

    shown = [receipt(client, i) for i in ids]

    assert shown[0]["lines"] == shown[1]["lines"]
    assert shown[0]["amount"] == OUTSTANDING + 8_000_00
    assert [(r["description"], r["paid"], r["owed_after"], r["redeemed"]) for r in shown[0]["lines"]] == [
        ("Gold ring", 8_000_00, 50_000_00 + 6_000_00 - 8_000_00, False),
        ("Gold chain", OUTSTANDING, 0, True),
    ]
    text = shown[0]["text"]
    assert "Gold chain (Redeemed)\nPaid" in text
    assert chain["name"] not in text


def test_once_the_redeemed_mortgage_is_reopened_the_receipt_covers_the_rest(
    client, ramesh, chain, ring
):
    first = pay(
        client,
        ramesh,
        {chain["id"]: OUTSTANDING, ring["id"]: 8_000_00},
        on=ON,
        redeeming=[chain["id"]],
    )
    client.post(f"/api/mortgages/{chain['id']}/reopen", json={"reason": "Mistake"})

    shown = receipt(client, first["id"])

    assert shown["amount"] == 8_000_00
    assert [r["description"] for r in shown["lines"]] == ["Gold ring"]


def test_one_payment_can_redeem_several_mortgages_with_one_receipt_even_after_a_reopen(
    client, ramesh, chain, ring
):
    ring_amount = 50_000_00 + 4_500_00 + 1_500_00  # with its Interest to Date (full month)
    pay(
        client,
        ramesh,
        {chain["id"]: OUTSTANDING, ring["id"]: ring_amount},
        on=ON,
        redeeming=[chain["id"], ring["id"]],
    )
    assert [mortgage(client, m)["status"] for m in (chain, ring)] == ["redeemed"] * 2
    ids = sorted(p["id"] for p in payments(client))
    assert receipt(client, ids[1])["amount"] == OUTSTANDING + ring_amount

    # Reopening the first Redeemed voids its final Payment; the other keeps its Receipt.
    client.post(f"/api/mortgages/{chain['id']}/reopen", json={"reason": "Mistake"})

    assert [r["description"] for r in receipt(client, ids[1])["lines"]] == ["Gold ring"]


def test_the_ordinary_part_can_be_voided_on_its_own(client, ramesh, chain, ring):
    first = pay(
        client,
        ramesh,
        {chain["id"]: OUTSTANDING, ring["id"]: 8_000_00},
        on=ON,
        redeeming=[chain["id"]],
    )

    response = client.post(f"/api/payments/{first['id']}/void", json={"reason": "Bounced"})

    assert response.status_code == 200, response.text
    assert mortgage(client, chain)["status"] == "redeemed"
    assert mortgage(client, ring)["outstanding"]["total"] == 50_000_00 + 6_000_00


def test_a_back_dated_payment_that_redeems_before_a_later_payment_is_refused(
    client, ramesh, chain
):
    pay(client, ramesh, {chain["id"]: 1_000_00}, on="2026-04-18")
    asked = payment_of(ramesh, {chain["id"]: 1}, paid_on="2026-04-16", redeeming=[chain["id"]])

    response = client.post("/api/payments/preview", json=asked)

    assert response.status_code == 422
    assert "There are Payments after that date" in response.json()["detail"]


def test_paying_the_whole_outstanding_without_redeeming_is_refused(
    client, ramesh, chain
):
    asked = payment_of(ramesh, {chain["id"]: OUTSTANDING})

    response = client.post("/api/payments", json=asked)

    assert response.status_code == 422
    assert response.json()["detail"] == (
        f"{chain['name']}: ₹1,12,000 is its whole Outstanding on 20 Apr 2026: "
        "Redeem it with this Payment instead"
    )


# --- A Mortgage paid up to its last Accrual Date before ADR 0011 (once Ready to
# Redeem) owes its Interest to Date, and paying that Redeems it.


def test_a_mortgage_paid_up_to_its_last_accrual_date_owes_its_interest_to_date(
    client, ramesh, chain
):
    # ₹1,09,000 on 15 Apr paid the Principal and the interest charged by 14 Apr; the
    # month from 14 Apr is still owed: ₹3,000 under the Full-month rule.
    pay(client, ramesh, {chain["id"]: 109_000_00}, on="2026-04-15")
    shown = mortgage(client, chain)
    assert (shown["status"], shown["outstanding"]["total"]) == ("active", 3_000_00)

    payment = pay(
        client, ramesh, {chain["id"]: 3_000_00}, on=ON, redeeming=[chain["id"]]
    )

    redeemed = mortgage(client, chain)
    assert (redeemed["status"], redeemed["outstanding"]["total"]) == ("redeemed", 0)
    assert redeemed["closure"]["payment_id"] == payment["id"]
    assert receipt(client, payment["id"])["total_owed"] == 0
