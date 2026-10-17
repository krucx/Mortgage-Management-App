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


def test_payments_by_month_for_the_last_twelve_months(client, book):
    months = dashboard(client)["payments_by_month"]

    assert [c["month"] for c in months][:2] == ["2025-05", "2025-06"]
    assert months[-1]["month"] == "2026-04"
    assert len(months) == 12
    # The Voided ₹1,000 is left out; the Forfeiture brought in no Payment.
    by_month = {c["month"]: c["amount"] for c in months}
    assert by_month["2026-02"] == 2_000 * RUPEE
    assert by_month["2026-04"] == (5_000 + 53_000) * RUPEE
    assert sum(by_month.values()) == 60_000 * RUPEE


def test_an_empty_book(client):
    figures = dashboard(client)

    assert figures["active_mortgages"] == 0
    assert figures["principal_outstanding"] == 0
    assert figures["collateral_value"] == 0
    assert figures["loan_to_value"] is None
    assert all(c["amount"] == 0 for c in figures["payments_by_month"])


def listed(client, path, **params):
    response = client.get(f"/api/{path}", params=params)
    assert response.status_code == 200, response.text
    return response.json()


def test_customers_with_active_mortgages_are_listed_as_counted(client, book):
    shown = listed(client, "customers", has_active_mortgage=True)

    assert shown["total"] == dashboard(client)["customers_with_active_mortgages"]
    assert [c["name"] for c in shown["items"]] == ["Ramesh Kumar"]
    assert listed(client, "customers")["total"] == 2


def test_payments_in_a_month_or_year_add_up_to_the_interest_collected(client, book):
    figures = dashboard(client)

    month = listed(client, "payments", month="2026-04", include_voided=False)
    year = listed(client, "payments", year=2026, include_voided=False)

    # April: Ramesh's ₹5,000 and the ₹53,000 Redemption; the Voided ₹1,000 left out.
    assert [p["amount"] for p in month["items"]] == [5_000 * RUPEE, 53_000 * RUPEE]
    assert month["interest_paid"] == figures["interest_collected_this_month"]
    assert year["total"] == 3
    assert year["interest_paid"] == figures["interest_collected_this_year"]
    assert listed(client, "payments", month="2026-04")["total"] == 3
    assert listed(client, "payments")["interest_paid"] is None


def test_mortgages_closed_in_a_month_are_listed_as_counted(client, book):
    owner = person(client, "Mahesh Jain", "9829099999")
    earlier = lend(client, owner, "2026-01-05", 10_000, "Anklet")
    client.post(
        f"/api/mortgages/{earlier['id']}/forfeit",
        json={"forfeited_on": "2026-03-05", "recovered_amount": 0, "note": ""},
    )
    figures = dashboard(client)

    redeemed = listed(client, "mortgages", status="redeemed", closed_in="2026-04")
    forfeited = listed(client, "mortgages", status="forfeited", closed_in="2026-04")

    assert redeemed["total"] == figures["redeemed_this_month"] == 1
    assert forfeited["total"] == figures["forfeited_this_month"] == 1
    assert [m["name"] for m in forfeited["items"]] != [earlier["name"]]
    assert listed(client, "mortgages", status="forfeited")["total"] == 2


def test_a_voided_payment_is_listed_but_paid_no_interest(client):
    owner = person(client, "Mahesh Jain", "9829099999")
    anklet = lend(client, owner, "2026-01-05", 10_000, "Anklet")
    mistake = pay(client, owner, anklet, "2026-04-06", 300)
    client.post(f"/api/payments/{mistake['id']}/void", json={"reason": "typo"})

    shown = listed(client, "payments", month="2026-04")

    assert (shown["total"], shown["interest_paid"]) == (1, 0)


@pytest.fixture
def march_redemption(client, book):
    """Mahesh: ₹10,000 from 1 Feb, Redeemed 1 Mar for ₹10,300 (one month at 3%)."""
    owner = person(client, "Mahesh Jain", "9829099999")
    anklet = lend(client, owner, "2026-02-01", 10_000, "Anklet")
    response = client.post(
        f"/api/mortgages/{anklet['id']}/redeem",
        json={"redeemed_on": "2026-03-01", "method": "cash"},
    )
    assert response.status_code == 200, response.text


def test_contractual_projections_are_the_interest_the_active_mortgages_will_accrue(
    client, march_redemption
):
    projections = dashboard(client)["projections"]

    # Only Ramesh's ₹1,00,000 is Active: ₹3,000 on each 14th, nothing else changing.
    assert [(p["months"], p["on"], p["interest_accrued"]) for p in projections] == [
        (3, "2026-07-20", 9_000 * RUPEE),
        (6, "2026-10-20", 18_000 * RUPEE),
        (12, "2027-04-20", 36_000 * RUPEE),
    ]


def test_trend_projections_carry_the_last_three_full_months_forward(
    client, march_redemption
):
    figures = dashboard(client)

    # January to March (April is not over): Payments ₹2,000 (20 Feb) + ₹10,300
    # (1 Mar); ₹1,00,000 + ₹30,000 + ₹50,000 + ₹10,000 lent; 1 Redemption.
    assert figures["trend_months"] == ["2026-01", "2026-02", "2026-03"]
    assert [
        (
            p["months"],
            p["payments_estimate"],
            p["principal_lent_estimate"],
            p["redemptions_estimate"],
        )
        for p in figures["projections"]
    ] == [
        (3, 12_300 * RUPEE, 1_90_000 * RUPEE, 1),
        (6, 24_600 * RUPEE, 3_80_000 * RUPEE, 2),
        (12, 49_200 * RUPEE, 7_60_000 * RUPEE, 4),
    ]


def test_the_coming_months_continue_the_payments_history(client, march_redemption):
    coming = dashboard(client)["coming_months"]

    assert [m["month"] for m in coming][:2] == ["2026-05", "2026-06"]
    assert coming[-1]["month"] == "2027-04"
    assert len(coming) == 12
    assert {m["interest_charged"] for m in coming} == {3_000 * RUPEE}
    assert {m["payments_estimate"] for m in coming} == {4_100 * RUPEE}


def test_estimates_are_to_the_whole_rupee(client, book):
    figures = dashboard(client)

    # ₹2,000 received January to March: ₹666.67 a month, shown as about ₹667.
    assert {m["payments_estimate"] for m in figures["coming_months"]} == {667 * RUPEE}
    assert figures["projections"][0]["payments_estimate"] == 2_000 * RUPEE
