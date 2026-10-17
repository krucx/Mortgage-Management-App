"""Closing a Mortgage: Redemption (paid in full, jewellery returned) or Forfeiture."""

import pytest

LAKH = 100_000_00  # ₹1,00,000 in paise


@pytest.fixture
def ramesh(client):
    return client.post(
        "/api/customers",
        json={"name": "Ramesh Kumar", "address": "", "phone_1": "9829012345"},
    ).json()


def open_mortgage(client, customer, part_month_rule="full_month"):
    # ₹1,00,000 at 3% Simple from 14 Jan; today (conftest) is 20 Apr 2026.
    return client.post(
        "/api/mortgages",
        json={
            "customer_id": customer["id"],
            "start_date": "2026-01-14",
            "amount_lent": LAKH,
            "description": "Gold chain",
            "gross_weight_mg": 20_000,
            "net_weight_mg": 19_000,
            "purity_karat": 22,
            "terms": {
                "monthly_rate_bps": 300,
                "interest_mode": "simple",
                "part_month_rule": part_month_rule,
            },
        },
    ).json()


@pytest.fixture
def mortgage(client, ramesh):
    return open_mortgage(client, ramesh)


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
    mortgage = open_mortgage(client, ramesh, part_month_rule=rule)

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

    assert response.status_code == 422


def test_a_paid_off_mortgage_redeemed_on_an_accrual_date_needs_no_final_payment(
    client, ramesh, mortgage
):
    client.post(
        "/api/payments",
        json={
            "customer_id": ramesh["id"],
            "paid_on": "2026-04-14",
            "amount": 109_000_00,
            "method": "cash",
            "allocations": [{"mortgage_id": mortgage["id"], "amount": 109_000_00}],
        },
    )
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
    client.post(
        "/api/payments",
        json={
            "customer_id": ramesh["id"],
            "paid_on": "2026-04-01",
            "amount": 1_000_00,
            "method": "cash",
            "allocations": [{"mortgage_id": mortgage["id"], "amount": 1_000_00}],
        },
    )

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

    assert response.status_code == 422


def test_closed_mortgages_can_be_listed_by_status(client, ramesh, mortgage):
    redeem(client, mortgage)
    open_mortgage(client, ramesh)

    def statuses(**params):
        return [
            r["status"]
            for r in client.get("/api/mortgages", params=params).json()["items"]
        ]

    assert statuses(status="redeemed") == ["redeemed"]
    assert statuses(status="active") == ["active"]


def test_paying_a_mortgage_down_to_nothing_does_not_redeem_it(client, ramesh, mortgage):
    client.post(
        "/api/payments",
        json={
            "customer_id": ramesh["id"],
            "paid_on": "2026-04-14",
            "amount": 109_000_00,
            "method": "cash",
            "allocations": [{"mortgage_id": mortgage["id"], "amount": 109_000_00}],
        },
    )

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


def pay_all(client, customer, mortgage, amount, on):
    response = client.post(
        "/api/payments",
        json={
            "customer_id": customer["id"],
            "paid_on": on,
            "amount": amount,
            "method": "cash",
            "allocations": [{"mortgage_id": mortgage["id"], "amount": amount}],
        },
    )
    assert response.status_code == 201, response.text


def ready(client):
    response = client.get("/api/closures/ready-to-redeem")
    assert response.status_code == 200
    return response.json()


def test_nothing_is_ready_to_redeem_while_something_is_outstanding(client, mortgage):
    assert ready(client) == []


def test_a_paid_off_mortgage_is_ready_to_redeem_with_todays_redemption_amount(
    client, ramesh, mortgage
):
    other = open_mortgage(client, ramesh)
    # Paid off on an Accrual Date: the new month starts with no Principal, so no charge.
    pay_all(client, ramesh, mortgage, 109_000_00, "2026-04-14")
    # Paid off mid-month (today, 6 days in): redeeming adds a full month on ₹1,00,000.
    pay_all(client, ramesh, other, 109_000_00, "2026-04-20")

    items = ready(client)

    assert [(i["mortgage"]["name"], i["redemption"]["total"]) for i in items] == [
        (mortgage["name"], 0),
        (other["name"], 3_000_00),
    ]
    assert items[0]["mortgage"]["customer"]["name"] == "Ramesh Kumar"
    assert items[0]["redemption"]["on"] == "2026-04-20"


def test_a_redeemed_mortgage_is_no_longer_waiting(client, ramesh, mortgage):
    pay_all(client, ramesh, mortgage, 109_000_00, "2026-04-14")

    redeem(client, mortgage)

    assert ready(client) == []


def test_mortgages_can_be_listed_by_whether_anything_is_outstanding(
    client, ramesh, mortgage
):
    other = open_mortgage(client, ramesh)
    pay_all(client, ramesh, mortgage, 109_000_00, "2026-04-14")

    page = client.get(
        "/api/mortgages", params={"status": "active", "owing": True}
    ).json()

    assert [row["id"] for row in page["items"]] == [other["id"]]
    assert page["total"] == 1
