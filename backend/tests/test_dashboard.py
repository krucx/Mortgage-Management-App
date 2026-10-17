"""The Dashboard: the whole lending book at a glance (today is 20 Apr 2026, see
conftest). Every figure comes from replaying the Mortgages and from stored Payments."""

import pytest

RUPEE = 100  # paise
SIMPLE_3 = {
    "monthly_rate_bps": 300,
    "interest_mode": "simple",
    "part_month_rule": "full_month",
}


def person(client, name, phone):
    return client.post(
        "/api/customers", json={"name": name, "address": "", "phone_1": phone}
    ).json()


def lend(client, owner, start, rupees, description):
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
            "terms": SIMPLE_3,
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


def pay(client, owner, mortgage, on, rupees):
    response = client.post(
        "/api/payments",
        json={
            "customer_id": owner["id"],
            "paid_on": on,
            "amount": rupees * RUPEE,
            "method": "cash",
            "allocations": [{"mortgage_id": mortgage["id"], "amount": rupees * RUPEE}],
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


def dashboard(client):
    response = client.get("/api/dashboard")
    assert response.status_code == 200, response.text
    return response.json()


@pytest.fixture
def book(client):
    """
    Ramesh: ₹1,00,000 from 14 Jan, Active; ₹2,000 paid 20 Feb and ₹5,000 on 15 Apr
      (all interest), and ₹1,000 on 16 Apr that was Voided. Owes ₹1,00,000 + ₹2,000.
    Suresh: ₹50,000 from 10 Mar, Redeemed 12 Apr for ₹53,000 (₹1,500 interest on
      10 Apr, ₹1,500 more under the Full-month rule).
    Suresh: ₹30,000 from 5 Feb, Forfeited 5 Apr owing ₹31,800; the jewellery
      fetched ₹40,000, a ₹8,200 profit.
    22K gold at ₹6,000 a gram: Ramesh's 19 g is worth ₹1,14,000.
    """
    ramesh = person(client, "Ramesh Kumar", "9829012345")
    suresh = person(client, "Suresh Jain", "9829054321")
    chain = lend(client, ramesh, "2026-01-14", 1_00_000, "Gold chain")
    pay(client, ramesh, chain, "2026-02-20", 2_000)
    pay(client, ramesh, chain, "2026-04-15", 5_000)
    mistake = pay(client, ramesh, chain, "2026-04-16", 1_000)
    client.post(f"/api/payments/{mistake['id']}/void", json={"reason": "typo"})
    ring = lend(client, suresh, "2026-03-10", 50_000, "Ring")
    client.post(
        f"/api/mortgages/{ring['id']}/redeem",
        json={"redeemed_on": "2026-04-12", "method": "cash"},
    )
    bangle = lend(client, suresh, "2026-02-05", 30_000, "Bangle")
    client.post(
        f"/api/mortgages/{bangle['id']}/forfeit",
        json={
            "forfeited_on": "2026-04-05",
            "recovered_amount": 40_000 * RUPEE,
            "note": "",
        },
    )
    client.put(
        "/api/settings/gold-rates",
        json=[{"purity_karat": 22, "rate_per_gram": 6_000 * RUPEE}],
    )


def test_what_the_active_mortgages_owe(client, book):
    figures = dashboard(client)

    assert figures["active_mortgages"] == 1
    assert figures["customers_with_active_mortgages"] == 1
    assert figures["principal_outstanding"] == 1_00_000 * RUPEE
    assert figures["unpaid_interest"] == 2_000 * RUPEE


def test_interest_collected_this_month_and_this_year(client, book):
    figures = dashboard(client)

    # April: ₹5,000 from Ramesh, ₹3,000 in the Redemption; the year adds February.
    assert figures["interest_collected_this_month"] == 8_000 * RUPEE
    assert figures["interest_collected_this_year"] == 10_000 * RUPEE


def test_collateral_and_loan_to_value(client, book):
    figures = dashboard(client)

    assert figures["collateral_value"] == 1_14_000 * RUPEE
    assert figures["loan_to_value"] == pytest.approx(1_02_000 / 1_14_000)
    # Above the 85% Loan-to-Value line, so Ramesh's Mortgage is on the Call List.
    assert figures["call_list_count"] == 1


def test_closures_this_month(client, book):
    figures = dashboard(client)

    assert figures["redeemed_this_month"] == 1
    assert figures["forfeited_this_month"] == 1
    assert figures["forfeiture_profit_loss_this_month"] == 8_200 * RUPEE


def test_monthly_collections_for_the_last_twelve_months(client, book):
    collections = dashboard(client)["monthly_collections"]

    assert [c["month"] for c in collections][:2] == ["2025-05", "2025-06"]
    assert collections[-1]["month"] == "2026-04"
    assert len(collections) == 12
    # The Voided ₹1,000 is left out; the Forfeiture brought in no Payment.
    by_month = {c["month"]: c["amount"] for c in collections}
    assert by_month["2026-02"] == 2_000 * RUPEE
    assert by_month["2026-04"] == (5_000 + 53_000) * RUPEE
    assert sum(by_month.values()) == 60_000 * RUPEE


def test_an_empty_book(client):
    figures = dashboard(client)

    assert figures["active_mortgages"] == 0
    assert figures["principal_outstanding"] == 0
    assert figures["collateral_value"] == 0
    assert figures["loan_to_value"] is None
    assert all(c["amount"] == 0 for c in figures["monthly_collections"])
