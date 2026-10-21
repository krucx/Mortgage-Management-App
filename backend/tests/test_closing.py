"""Closing a Mortgage: Redemption (paid in full, jewellery returned), Waiver (paid in
part, the rest let off, jewellery returned) or Forfeiture."""

import pytest
from api_seed import SIMPLE_3, lend, pay, person
from seed import LAKH


@pytest.fixture
def ramesh(client):
    return person(client)


@pytest.fixture
def mortgage(client, ramesh):
    return lend(client, ramesh)


def redemption(client, mortgage, on="2026-04-20"):
    response = client.get(
        f"/api/mortgages/{mortgage['id']}/redemption", params={"on": on}
    )
    assert response.status_code == 200, response.text
    return response.json()


def redeem(client, mortgage, on="2026-04-20", **extra):
    return client.post(
        f"/api/mortgages/{mortgage['id']}/redeem",
        json={"redeemed_on": on, "method": "cash", **extra},
    )


@pytest.mark.parametrize(
    ("rule", "charge"),
    [
        ("full_month", 3_000_00),
        ("pro_rata", 600_00),
        ("nothing", 0),
    ],  # pro-rata: 6 days of 30
)
def test_the_redemption_amount_includes_the_part_month_rule_charge(
    client, ramesh, rule, charge
):
    mortgage = lend(client, ramesh, terms={**SIMPLE_3, "part_month_rule": rule})

    # Accrued 14 Feb, 14 Mar, 14 Apr (₹9,000); 20 Apr is 6 days into the next month.
    assert redemption(client, mortgage) == {
        "on": "2026-04-20",
        "principal": LAKH,
        "unpaid_interest": 9_000_00,
        "part_month_days": 6,
        "part_month_charge": charge,
        "total": LAKH + 9_000_00 + charge,
    }


def test_redeeming_records_the_final_payment_and_closes_the_mortgage(client, mortgage):
    response = redeem(client, mortgage, reference="UTR1")

    assert response.status_code == 200, response.text
    page = response.json()
    assert page["status"] == "redeemed"
    assert page["outstanding"] == {"principal": 0, "unpaid_interest": 0, "total": 0}
    assert [s["event"] for s in page["ledger"][-2:]] == ["part_month", "payment"]
    closure = page["closure"]
    assert (closure["kind"], closure["on"], closure["redemption_amount"]) == (
        "redeemed",
        "2026-04-20",
        112_000_00,
    )
    payment = client.get(f"/api/payments/{closure['payment_id']}").json()
    assert payment["amount"] == 112_000_00
    assert payment["reference"] == "UTR1"


def test_a_redeemed_mortgage_stops_accruing(client, mortgage):
    redeem(client, mortgage, on="2026-03-01")

    page = client.get(f"/api/mortgages/{mortgage['id']}").json()

    assert page["ledger"][-1]["on"] == "2026-03-01"
    assert page["outstanding"]["total"] == 0


def test_a_closed_mortgage_takes_no_more_payments(client, ramesh, mortgage):
    redeem(client, mortgage)

    response = client.post(
        "/api/payments",
        json={
            "customer_id": ramesh["id"],
            "paid_on": "2026-04-20",
            "amount": 1_000_00,
            "method": "cash",
            "allocations": [{"mortgage_id": mortgage["id"], "amount": 1_000_00}],
        },
    )

    assert response.status_code == 409
    assert "reopen it first" in response.json()["detail"]


def test_a_paid_off_mortgage_redeemed_on_an_accrual_date_needs_no_final_payment(
    client, ramesh, mortgage
):
    pay(client, ramesh, {mortgage["id"]: 109_000_00}, on="2026-04-14")
    assert redemption(client, mortgage, on="2026-04-14")["total"] == 0

    page = redeem(client, mortgage, on="2026-04-14").json()

    assert page["status"] == "redeemed"
    assert page["closure"]["payment_id"] is None


@pytest.mark.parametrize(
    "on",
    [
        "2026-04-21",  # in the future: it can be quoted, but not recorded
        "2026-01-13",  # before the Mortgage started
    ],
)
def test_redeeming_on_an_impossible_date_is_refused(client, mortgage, on):
    assert redeem(client, mortgage, on=on).status_code == 422
    assert client.get(f"/api/mortgages/{mortgage['id']}").json()["status"] == "active"


def test_redeeming_before_an_existing_payment_is_refused(client, ramesh, mortgage):
    pay(client, ramesh, {mortgage["id"]: 1_000_00}, on="2026-04-01")

    response = redeem(client, mortgage, on="2026-03-20")

    assert response.status_code == 422
    assert "after" in response.json()["detail"]


def test_a_mortgage_can_be_closed_only_once(client, mortgage):
    redeem(client, mortgage)

    assert redeem(client, mortgage).status_code == 422
    forfeit = client.post(
        f"/api/mortgages/{mortgage['id']}/forfeit",
        json={"forfeited_on": "2026-04-20", "recovered_amount": LAKH, "note": ""},
    )
    assert forfeit.status_code == 422


@pytest.mark.parametrize(
    ("recovered", "profit_loss"),
    [(120_000_00, 8_000_00), (100_000_00, -12_000_00)],
)
def test_forfeiting_records_what_was_recovered_and_the_profit_or_loss(
    client, mortgage, recovered, profit_loss
):
    response = client.post(
        f"/api/mortgages/{mortgage['id']}/forfeit",
        json={
            "forfeited_on": "2026-04-20",
            "recovered_amount": recovered,
            "note": "Sold to Bhandari",
        },
    )

    assert response.status_code == 200, response.text
    page = response.json()
    assert page["status"] == "forfeited"
    assert page["closure"] == {
        "kind": "forfeited",
        "on": "2026-04-20",
        "redemption_amount": 112_000_00,
        "payment_id": None,
        "payment_amount": None,
        "waived_amount": None,
        "recovered_amount": recovered,
        "profit_loss": profit_loss,
        "note": "Sold to Bhandari",
    }
    # The jewellery settles the debt; any shortfall shows as the loss, not as Outstanding.
    assert page["outstanding"]["total"] == 0
    assert page["ledger"][-1]["event"] == "forfeited"


def test_a_forfeited_mortgage_takes_no_more_payments(client, ramesh, mortgage):
    client.post(
        f"/api/mortgages/{mortgage['id']}/forfeit",
        json={"forfeited_on": "2026-04-20", "recovered_amount": LAKH, "note": ""},
    )

    response = client.post(
        "/api/payments",
        json={
            "customer_id": ramesh["id"],
            "paid_on": "2026-04-20",
            "amount": 1_000_00,
            "method": "cash",
            "allocations": [{"mortgage_id": mortgage["id"], "amount": 1_000_00}],
        },
    )

    assert response.status_code == 409
    assert "reopen it first" in response.json()["detail"]


def waive(client, mortgage, paid, on="2026-04-20", **extra):
    return client.post(
        f"/api/mortgages/{mortgage['id']}/waive",
        json={"waived_on": on, "amount_paid": paid, "method": "cash", **extra},
    )


def test_waiving_records_the_final_payment_and_lets_off_the_rest(client, mortgage):
    # ₹1,12,000 owed on 20 Apr; the Customer pays ₹1,11,500 and ₹500 is waived.
    response = waive(client, mortgage, 111_500_00, reference="UTR9", note="Old friend")

    assert response.status_code == 200, response.text
    page = response.json()
    assert page["status"] == "waived"
    assert page["outstanding"]["total"] == 0
    assert [(s["event"], s["amount"]) for s in page["ledger"][-2:]] == [
        ("payment", 111_500_00),
        ("waived", 500_00),
    ]
    closure = page["closure"]
    assert (closure["kind"], closure["redemption_amount"], closure["waived_amount"]) == (
        "waived",
        112_000_00,
        500_00,
    )
    assert closure["note"] == "Old friend"
    payment = client.get(f"/api/payments/{closure['payment_id']}").json()
    assert (payment["amount"], payment["reference"]) == (111_500_00, "UTR9")


def test_everything_owed_can_be_waived_with_no_final_payment(client, mortgage):
    page = waive(client, mortgage, 0).json()

    assert page["closure"]["payment_id"] is None
    assert page["closure"]["waived_amount"] == 112_000_00


@pytest.mark.parametrize("paid", [112_000_00, 113_000_00])
def test_paying_everything_owed_is_a_redemption_not_a_waiver(client, mortgage, paid):
    response = waive(client, mortgage, paid)

    assert response.status_code == 422
    assert "Redeem it instead" in response.json()["detail"]
    assert client.get(f"/api/mortgages/{mortgage['id']}").json()["status"] == "active"


def test_a_mortgage_owing_nothing_cannot_be_waived(client, ramesh, mortgage):
    pay(client, ramesh, {mortgage["id"]: 109_000_00}, on="2026-04-14")

    response = waive(client, mortgage, 0, on="2026-04-14")

    assert response.status_code == 422
    assert "Redeem it instead" in response.json()["detail"]


def test_a_waived_mortgage_takes_no_more_payments_and_cannot_be_closed_again(
    client, mortgage
):
    waive(client, mortgage, 100_000_00)

    assert redeem(client, mortgage).status_code == 422
    assert waive(client, mortgage, 0).status_code == 422


def test_closed_mortgages_can_be_listed_by_status(client, ramesh, mortgage):
    redeem(client, mortgage)
    lend(client, ramesh)

    def statuses(**params):
        return [
            r["status"]
            for r in client.get("/api/mortgages", params=params).json()["items"]
        ]

    assert statuses(status="redeemed") == ["redeemed"]
    assert statuses(status="active") == ["active"]


def test_paying_a_mortgage_down_to_nothing_does_not_redeem_it(client, ramesh, mortgage):
    pay(client, ramesh, {mortgage["id"]: 109_000_00}, on="2026-04-14")

    page = client.get(f"/api/mortgages/{mortgage['id']}").json()

    assert page["outstanding"]["total"] == 0
    assert (page["status"], page["closure"]) == ("active", None)


def test_the_redemption_amount_can_be_quoted_for_a_future_date(client, mortgage):
    # 20 May: one more month accrued on 14 May, then 6 days into the next (full month).
    assert (
        redemption(client, mortgage, on="2026-05-20")["total"]
        == LAKH + 12_000_00 + 3_000_00
    )


# --- Mortgages ready to Redeem: Active, with nothing Outstanding.


def ready(client):
    response = client.get("/api/closures/ready-to-redeem")
    assert response.status_code == 200
    return response.json()["items"]


def test_nothing_is_ready_to_redeem_while_something_is_outstanding(client, mortgage):
    assert ready(client) == []


def test_a_paid_off_mortgage_is_ready_to_redeem_with_todays_redemption_amount(
    client, ramesh, mortgage
):
    other = lend(client, ramesh)
    # Paid off on an Accrual Date: the new month starts with no Principal, so no charge.
    pay(client, ramesh, {mortgage["id"]: 109_000_00}, on="2026-04-14")
    # Paid off mid-month (today, 6 days in): redeeming adds a full month on ₹1,00,000.
    pay(client, ramesh, {other["id"]: 109_000_00}, on="2026-04-20")

    items = ready(client)

    assert [(i["mortgage"]["name"], i["redemption"]["total"]) for i in items] == [
        (mortgage["name"], 0),
        (other["name"], 3_000_00),
    ]
    assert items[0]["mortgage"]["customer"]["name"] == "Ramesh Kumar"
    assert items[0]["redemption"]["on"] == "2026-04-20"


def test_a_redeemed_mortgage_is_no_longer_waiting(client, ramesh, mortgage):
    pay(client, ramesh, {mortgage["id"]: 109_000_00}, on="2026-04-14")

    redeem(client, mortgage)

    assert ready(client) == []


def test_mortgages_can_be_listed_by_whether_anything_is_outstanding(
    client, ramesh, mortgage
):
    other = lend(client, ramesh)
    pay(client, ramesh, {mortgage["id"]: 109_000_00}, on="2026-04-14")

    page = client.get(
        "/api/mortgages", params={"status": "active", "owing": True}
    ).json()

    assert [row["id"] for row in page["items"]] == [other["id"]]
    assert page["total"] == 1


def forfeit_all(client, recovered, on="2026-04-20", note="Auctioned", preview=False):
    """Forfeit a set of Mortgages on one date: `recovered` is each one's Recovered
    Amount, by Mortgage."""
    return client.post(
        "/api/closures/forfeit" + ("-preview" if preview else ""),
        json={
            "forfeited_on": on,
            "note": note,
            "mortgages": [
                {"mortgage_id": m["id"], "recovered_amount": amount}
                for m, amount in recovered
            ],
        },
    )


def test_forfeiting_several_closes_each_with_its_own_recovered_amount(
    client, ramesh, mortgage
):
    other = lend(client, ramesh)
    # ₹1,12,000 owed on each on 20 Apr.
    response = forfeit_all(client, [(mortgage, 120_000_00), (other, 100_000_00)])

    assert response.status_code == 200, response.text
    closures = {
        m["id"]: client.get(f"/api/mortgages/{m['id']}").json()["closure"]
        for m in (mortgage, other)
    }
    assert [
        (c["kind"], c["recovered_amount"], c["profit_loss"], c["note"])
        for c in (closures[mortgage["id"]], closures[other["id"]])
    ] == [
        ("forfeited", 120_000_00, 8_000_00, "Auctioned"),
        ("forfeited", 100_000_00, -12_000_00, "Auctioned"),
    ]
    history = client.get(f"/api/mortgages/{other['id']}/history").json()
    assert ("forfeited", "on 20 Apr 2026, recovered ₹1,00,000") in [
        (entry["action"], entry["note"]) for entry in history
    ]


def test_the_preview_of_forfeiting_several_shows_each_closure_and_saves_nothing(
    client, ramesh, mortgage
):
    other = lend(client, ramesh)

    response = forfeit_all(
        client, [(mortgage, 120_000_00), (other, 100_000_00)], preview=True
    )

    assert response.status_code == 200, response.text
    previews = response.json()
    assert [p["mortgage_id"] for p in previews] == [mortgage["id"], other["id"]]
    assert [p["before"]["closure"] for p in previews] == [None, None]
    assert [
        (p["after"]["closure"]["kind"], p["after"]["closure"]["profit_loss"])
        for p in previews
    ] == [("forfeited", 8_000_00), ("forfeited", -12_000_00)]
    for m in (mortgage, other):
        assert client.get(f"/api/mortgages/{m['id']}").json()["status"] == "active"


def test_if_any_one_cannot_be_forfeited_none_are_and_the_reason_names_it(
    client, ramesh, mortgage
):
    other = lend(client, ramesh, name="2026-Ramesh-Bangles")
    pay(client, ramesh, {other["id"]: 1_000_00}, on="2026-04-20")

    response = forfeit_all(
        client, [(mortgage, LAKH), (other, LAKH)], on="2026-04-15"
    )

    assert response.status_code == 422
    detail = response.json()["detail"]
    assert detail.startswith("2026-Ramesh-Bangles: There are Payments after that date")
    for m in (mortgage, other):
        assert client.get(f"/api/mortgages/{m['id']}").json()["status"] == "active"
    history = client.get(f"/api/mortgages/{mortgage['id']}/history").json()
    assert "forfeited" not in [entry["action"] for entry in history]


def waive_all(client, paid, on="2026-04-20", preview=False, reference="UTR9"):
    """Waive off a set of Mortgages on one date: `paid` is what each one's final Payment
    brings in, by Mortgage."""
    return client.post(
        "/api/closures/waive" + ("-preview" if preview else ""),
        json={
            "waived_on": on,
            "method": "upi",
            "reference": reference,
            "note": "Old friends",
            "mortgages": [
                {"mortgage_id": m["id"], "amount_paid": amount} for m, amount in paid
            ],
        },
    )


def test_waiving_off_several_lets_off_each_rest_and_keeps_the_reference(
    client, ramesh, mortgage
):
    other = lend(client, ramesh)
    # ₹1,12,000 owed on each on 20 Apr.
    response = waive_all(client, [(mortgage, 111_500_00), (other, 110_000_00)])

    assert response.status_code == 200, response.text
    closures = [
        client.get(f"/api/mortgages/{m['id']}").json()["closure"] for m in (mortgage, other)
    ]
    assert [(c["kind"], c["payment_amount"], c["waived_amount"]) for c in closures] == [
        ("waived", 111_500_00, 500_00),
        ("waived", 110_000_00, 2_000_00),
    ]
    payments = [client.get(f"/api/payments/{c['payment_id']}").json() for c in closures]
    assert [(p["method"], p["reference"]) for p in payments] == [("upi", "UTR9")] * 2


def test_if_any_one_cannot_be_waived_off_none_are_and_the_reason_names_it(
    client, ramesh, mortgage
):
    other = lend(client, ramesh, name="2026-Ramesh-Bangles")

    # All that the Bangles owe is a Redemption, not a Waiver.
    response = waive_all(client, [(mortgage, 111_500_00), (other, 112_000_00)])

    assert response.status_code == 422
    assert response.json()["detail"] == (
        "2026-Ramesh-Bangles: ₹1,12,000 covers the ₹1,12,000 owed: Redeem it instead"
    )
    for m in (mortgage, other):
        assert client.get(f"/api/mortgages/{m['id']}").json()["status"] == "active"
    assert client.get("/api/payments").json()["items"] == []


def test_the_preview_of_waiving_off_several_shows_each_closure_and_saves_nothing(
    client, ramesh, mortgage
):
    other = lend(client, ramesh)

    response = waive_all(
        client, [(mortgage, 111_500_00), (other, 110_000_00)], preview=True
    )

    assert response.status_code == 200, response.text
    assert [p["after"]["closure"]["waived_amount"] for p in response.json()] == [
        500_00,
        2_000_00,
    ]
    for m in (mortgage, other):
        assert client.get(f"/api/mortgages/{m['id']}").json()["status"] == "active"


def redeem_all(client, mortgages, on="2026-04-20", preview=False):
    """Redeem a set of Mortgages on one date, any final Payments by UPI."""
    return client.post(
        "/api/closures/redeem" + ("-preview" if preview else ""),
        json={
            "redeemed_on": on,
            "method": "upi",
            "reference": "UTR5",
            "mortgage_ids": [m["id"] for m in mortgages],
        },
    )


def test_redeeming_several_closes_each_and_records_any_final_payment(
    client, ramesh, mortgage
):
    other = lend(client, ramesh)
    # Paid off on the 14 Apr Accrual Date: nothing more to pay.
    pay(client, ramesh, {mortgage["id"]: 109_000_00}, on="2026-04-14")
    # Paid off today, 6 days in: a full month's ₹3,000 is the final Payment.
    pay(client, ramesh, {other["id"]: 109_000_00}, on="2026-04-20")

    response = redeem_all(client, [mortgage, other])

    assert response.status_code == 200, response.text
    closures = [
        client.get(f"/api/mortgages/{m['id']}").json()["closure"] for m in (mortgage, other)
    ]
    assert [(c["kind"], c["payment_amount"]) for c in closures] == [
        ("redeemed", None),
        ("redeemed", 3_000_00),
    ]
    final = client.get(f"/api/payments/{closures[1]['payment_id']}").json()
    assert (final["method"], final["reference"]) == ("upi", "UTR5")


def test_if_any_one_cannot_be_redeemed_none_are_and_the_preview_saves_nothing(
    client, ramesh, mortgage
):
    other = lend(client, ramesh)
    pay(client, ramesh, {mortgage["id"]: 109_000_00}, on="2026-04-20")
    pay(client, ramesh, {other["id"]: 109_000_00}, on="2026-04-20")
    assert redeem(client, other).status_code == 200

    preview = redeem_all(client, [mortgage], preview=True)
    refused = redeem_all(client, [mortgage, other])

    assert [p["after"]["closure"]["payment_amount"] for p in preview.json()] == [3_000_00]
    assert refused.status_code == 422
    assert refused.json()["detail"] == f"{other['name']} is already redeemed"
    assert client.get(f"/api/mortgages/{mortgage['id']}").json()["status"] == "active"
