"""A Payment that redeems: an Allocation of a Mortgage's whole Redemption Amount, on the
Payment date, closes it with that Allocation as its final Payment; the rest of the
Payment, if any, is ordinary, and all of it is recorded or none."""

import pytest
from api_seed import SIMPLE_3, lend, pay, person
from seed import LAKH

# 20 Apr 2026, for a Mortgage of ₹1 lakh from 14 Jan at 3% (full-month Part-Month
# Rule): ₹9,000 accrued, plus ₹3,000 for the part-month.
ON = "2026-04-20"
REDEMPTION_AMOUNT = LAKH + 12_000_00


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


def test_a_payment_of_the_redemption_amount_redeems_the_mortgage_on_its_date(
    client, ramesh, chain
):
    payment = pay(
        client, ramesh, {chain["id"]: REDEMPTION_AMOUNT}, on=ON, redeeming=[chain["id"]]
    )

    closure = mortgage(client, chain)["closure"]
    assert (closure["kind"], closure["on"], closure["payment_amount"]) == (
        "redeemed",
        ON,
        REDEMPTION_AMOUNT,
    )
    assert closure["payment_id"] == payment["id"]


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


def test_an_amount_other_than_the_redemption_amount_is_refused_and_nothing_recorded(
    client, ramesh, chain
):
    asked = payment_of(ramesh, {chain["id"]: LAKH}, redeeming=[chain["id"]])

    response = client.post("/api/payments", json=asked)

    assert response.status_code == 422
    assert response.json()["detail"] == (
        f"{chain['name']}: ₹1,00,000 is not the Redemption Amount on 20 Apr 2026 "
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
        ramesh, {chain["id"]: REDEMPTION_AMOUNT, ring["id"]: 8_000_00}, redeeming=[chain["id"]]
    )

    response = client.post("/api/payments", json=asked)

    assert response.status_code == 201, response.text
    assert mortgage(client, chain)["status"] == "redeemed"
    assert mortgage(client, ring)["outstanding"]["total"] == 50_000_00 + 4_500_00 - 8_000_00
    recorded = sorted((p["amount"], p["method"], p["reference"]) for p in payments(client))
    assert recorded == [(8_000_00, "upi", "UTR9"), (REDEMPTION_AMOUNT, "upi", "UTR9")]


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
        {chain["id"]: REDEMPTION_AMOUNT, ring["id"]: 8_000_00},
        on=ON,
        redeeming=[chain["id"]],
    )

    response = client.post(
        f"/api/mortgages/{chain['id']}/reopen", json={"reason": "Recorded by mistake"}
    )

    assert response.status_code == 200, response.text
    left = [(p["amount"], p["voided"]) for p in payments(client)]
    assert sorted(left) == [(8_000_00, False), (REDEMPTION_AMOUNT, True)]


def test_the_preview_of_a_payment_that_redeems_shows_the_redemption_and_saves_nothing(
    client, ramesh, chain
):
    asked = payment_of(ramesh, {chain["id"]: REDEMPTION_AMOUNT}, redeeming=[chain["id"]])

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
        {chain["id"]: REDEMPTION_AMOUNT, ring["id"]: 8_000_00},
        on=ON,
        redeeming=[chain["id"]],
    )
    ids = [p["id"] for p in payments(client)]

    shown = [receipt(client, i) for i in ids]

    assert shown[0]["lines"] == shown[1]["lines"]
    assert shown[0]["amount"] == REDEMPTION_AMOUNT + 8_000_00
    assert [(r["description"], r["paid"], r["owed_after"], r["redeemed"]) for r in shown[0]["lines"]] == [
        ("Gold ring", 8_000_00, 50_000_00 + 4_500_00 - 8_000_00, False),
        ("Gold chain", REDEMPTION_AMOUNT, 0, True),
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
        {chain["id"]: REDEMPTION_AMOUNT, ring["id"]: 8_000_00},
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
    ring_amount = 50_000_00 + 4_500_00 + 1_500_00  # with its full-month charge
    pay(
        client,
        ramesh,
        {chain["id"]: REDEMPTION_AMOUNT, ring["id"]: ring_amount},
        on=ON,
        redeeming=[chain["id"], ring["id"]],
    )
    assert [mortgage(client, m)["status"] for m in (chain, ring)] == ["redeemed"] * 2
    ids = sorted(p["id"] for p in payments(client))
    assert receipt(client, ids[1])["amount"] == REDEMPTION_AMOUNT + ring_amount

    # Reopening the first Redeemed voids its final Payment; the other keeps its Receipt.
    client.post(f"/api/mortgages/{chain['id']}/reopen", json={"reason": "Mistake"})

    assert [r["description"] for r in receipt(client, ids[1])["lines"]] == ["Gold ring"]


def test_the_ordinary_part_can_be_voided_on_its_own(client, ramesh, chain, ring):
    first = pay(
        client,
        ramesh,
        {chain["id"]: REDEMPTION_AMOUNT, ring["id"]: 8_000_00},
        on=ON,
        redeeming=[chain["id"]],
    )

    response = client.post(f"/api/payments/{first['id']}/void", json={"reason": "Bounced"})

    assert response.status_code == 200, response.text
    assert mortgage(client, chain)["status"] == "redeemed"
    assert mortgage(client, ring)["outstanding"]["total"] == 50_000_00 + 4_500_00


def test_a_back_dated_payment_that_redeems_before_a_later_payment_is_refused(
    client, ramesh, chain
):
    pay(client, ramesh, {chain["id"]: 1_000_00}, on="2026-04-18")
    asked = payment_of(ramesh, {chain["id"]: 1}, paid_on="2026-04-16", redeeming=[chain["id"]])

    response = client.post("/api/payments/preview", json=asked)

    assert response.status_code == 422
    assert "There are Payments after that date" in response.json()["detail"]


def test_paying_the_whole_redemption_amount_without_redeeming_is_refused(client, ramesh):
    # With nothing charged for the part-month, the Redemption Amount is the Outstanding.
    nothing = lend(client, ramesh, terms={**SIMPLE_3, "part_month_rule": "nothing"})
    asked = payment_of(ramesh, {nothing["id"]: LAKH + 9_000_00})

    response = client.post("/api/payments", json=asked)

    assert response.status_code == 422
    assert response.json()["detail"] == (
        f"{nothing['name']}: ₹1,09,000 is its whole Redemption Amount on 20 Apr 2026: "
        "Redeem it with this Payment instead"
    )


# --- Redeeming after a Payment left a Mortgage Ready to Redeem: its Final Payment
# (the part-month charge) is a part of that Payment, on its Receipt.


def redeem_after(client, payment, mortgages, on=ON):
    return client.post(
        "/api/closures/redeem",
        json={
            "redeemed_on": on,
            "method": "upi",
            "reference": "UTR9",
            "mortgage_ids": [m["id"] for m in mortgages],
            "received_with": payment["id"],
        },
    )


def test_the_final_payment_of_a_redemption_after_a_payment_is_on_that_payments_receipt(
    client, ramesh, chain
):
    # ₹1,09,000 clears the Outstanding; Redeeming adds the ₹3,000 part-month charge.
    paid = pay(client, ramesh, {chain["id"]: 109_000_00}, on=ON)

    response = redeem_after(client, paid, [chain])

    assert response.status_code == 200, response.text
    shown = receipt(client, paid["id"])
    assert shown["amount"] == REDEMPTION_AMOUNT
    assert [(r["paid"], r["redeemed"]) for r in shown["lines"]] == [
        (109_000_00, False),
        (3_000_00, True),
    ]


def test_the_payment_redeemed_with_must_be_that_customers_on_the_redemption_date(
    client, ramesh, chain
):
    paid = pay(client, ramesh, {chain["id"]: 109_000_00}, on="2026-04-15")

    response = redeem_after(client, paid, [chain])

    assert response.status_code == 422
    assert response.json()["detail"] == (
        "The Payment it came with must be this Customer's, on 20 Apr 2026, and not Voided"
    )


def test_a_voided_payment_or_another_customers_cannot_be_redeemed_with(
    client, ramesh, chain
):
    voided = pay(client, ramesh, {chain["id"]: 1_000_00}, on=ON)
    client.post(f"/api/payments/{voided['id']}/void", json={"reason": "Bounced"})
    suresh = person(client, name="Suresh Shah", phone_1="9829099999")
    theirs = pay(client, suresh, {lend(client, suresh)["id"]: 1_000_00}, on=ON)

    refused = [redeem_after(client, p, [chain]) for p in (voided, theirs)]

    assert [r.status_code for r in refused] == [422, 422]
    assert all("The Payment it came with must be" in r.json()["detail"] for r in refused)
