"""Projections: a Mortgage's Ledger continued into the future (today is 20 Apr 2026,
see conftest)."""

import pytest

from api_seed import SIMPLE_3, lend, person
from seed import LAKH, RUPEE


@pytest.fixture
def ramesh(client):
    return person(client)


@pytest.fixture
def mortgage(client, ramesh):
    return lend(client, ramesh)


def change_terms(client, mortgage, **change):
    return client.post(f"/api/mortgages/{mortgage['id']}/term-changes", json=change)


def projection(client, mortgage, monthly_payment=None):
    params = {"monthly_payment": monthly_payment} if monthly_payment else {}
    response = client.get(f"/api/mortgages/{mortgage['id']}/projection", params=params)
    assert response.status_code == 200, response.text
    return response.json()


def at(series, months):
    return next(p for p in series["points"] if p["months"] == months)


def test_the_baseline_projection_assumes_no_more_payments(client, mortgage):
    baseline = projection(client, mortgage)["baseline"]

    assert [p["months"] for p in baseline["points"]] == list(range(13))
    in_three = at(baseline, 3)
    assert in_three["on"] == "2026-07-20"
    assert (in_three["principal"], in_three["unpaid_interest"]) == (
        LAKH,
        18_000 * RUPEE,
    )
    # Redeeming then adds the Part-Month Rule charge (full month).
    assert in_three["redemption_amount"] == 1_21_000 * RUPEE
    assert in_three["loan_to_value"] is None  # no Collateral Value yet
    assert baseline["paid_off_on"] is None


def test_loan_to_value_is_against_todays_collateral_value(client, mortgage):
    client.put(
        "/api/settings/gold-rates",
        json=[{"purity_karat": 22, "rate_per_gram": 6_000 * RUPEE}],
    )

    in_three = at(projection(client, mortgage)["baseline"], 3)

    assert in_three["loan_to_value"] == pytest.approx(1_18_000 / 1_14_000)


def test_what_if_they_pay_every_month(client, mortgage):
    what_if = projection(client, mortgage, monthly_payment=5_000 * RUPEE)["what_if"]

    # ₹5,000 on 14 May, Jun and Jul against ₹3,000 a month of interest.
    assert at(what_if, 3)["unpaid_interest"] == 3_000 * RUPEE
    assert at(what_if, 3)["principal"] == LAKH


def test_what_if_shows_when_it_would_be_paid_off(client, mortgage):
    what_if = projection(client, mortgage, monthly_payment=60_000 * RUPEE)["what_if"]

    # 14 May: ₹60,000 of ₹1,12,000; 14 Jun: the remaining ₹52,000 + ₹1,560.
    assert what_if["paid_off_on"] == "2026-06-14"
    assert at(what_if, 3)["redemption_amount"] == 0


def test_projections_follow_a_coming_term_change(client, mortgage):
    change_terms(client, mortgage, monthly_rate_bps=200)  # from 14 May

    in_three = at(projection(client, mortgage)["baseline"], 3)

    # 14 May still 3% (the month before it), then 2% on 14 Jun and 14 Jul.
    assert in_three["unpaid_interest"] == 16_000 * RUPEE


def test_a_closed_mortgage_has_no_projection(client, mortgage):
    client.post(
        f"/api/mortgages/{mortgage['id']}/forfeit",
        json={"forfeited_on": "2026-04-20", "recovered_amount": LAKH, "note": ""},
    )

    response = client.get(f"/api/mortgages/{mortgage['id']}/projection")

    assert response.status_code == 409


def test_a_projection_lists_its_coming_term_changes(client, mortgage):
    change_terms(client, mortgage, monthly_rate_bps=200)  # from 14 May

    coming = projection(client, mortgage)["baseline"]["term_changes"]

    assert [(c["on"], c["terms"]["monthly_rate_bps"]) for c in coming] == [
        ("2026-05-14", 200)
    ]


def test_compounding_capitalises_unpaid_interest_in_the_projection(client, ramesh):
    mortgage = lend(
        client, ramesh, terms={**SIMPLE_3, "interest_mode": "compounded_yearly"}
    )

    baseline = projection(client, mortgage)["baseline"]

    # 14 Jan 2027: a year's ₹36,000 becomes Principal; then 3% of ₹1,36,000 = ₹4,080
    # on 14 Feb, Mar and Apr 2027.
    in_a_year = at(baseline, 12)
    assert in_a_year["on"] == "2027-04-20"
    assert (in_a_year["principal"], in_a_year["unpaid_interest"]) == (
        1_36_000 * RUPEE,
        12_240 * RUPEE,
    )
    assert in_a_year["redemption_amount"] == (1_36_000 + 12_240 + 4_080) * RUPEE


def test_a_projection_lists_only_the_coming_years_term_changes(client, mortgage):
    change_terms(client, mortgage, monthly_rate_bps=200)  # 14 May 2026
    change_terms(client, mortgage, effective_on="2027-05-14", monthly_rate_bps=100)

    coming = projection(client, mortgage)["baseline"]["term_changes"]

    assert [c["on"] for c in coming] == ["2026-05-14"]
