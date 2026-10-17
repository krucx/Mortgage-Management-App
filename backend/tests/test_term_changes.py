"""Term Changes on a running Mortgage, and its Projections (today is 20 Apr 2026)."""

import pytest

RUPEE = 100  # paise
LAKH = 1_00_000 * RUPEE
SIMPLE_3 = {
    "monthly_rate_bps": 300,
    "interest_mode": "simple",
    "part_month_rule": "full_month",
}


@pytest.fixture
def ramesh(client):
    return client.post(
        "/api/customers",
        json={"name": "Ramesh Kumar", "address": "", "phone_1": "9829012345"},
    ).json()


def open_mortgage(client, owner, start="2026-01-14"):
    # ₹1,00,000 at 3% Simple: ₹3,000 a month; from 14 Jan it owes ₹1,09,000 today.
    response = client.post(
        "/api/mortgages",
        json={
            "customer_id": owner["id"],
            "start_date": start,
            "amount_lent": LAKH,
            "description": f"Gold chain {start}",
            "gross_weight_mg": 20_000,
            "net_weight_mg": 19_000,
            "purity_karat": 22,
            "terms": SIMPLE_3,
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


@pytest.fixture
def mortgage(client, ramesh):
    return open_mortgage(client, ramesh)


def change_terms(client, mortgage, **change):
    return client.post(f"/api/mortgages/{mortgage['id']}/term-changes", json=change)


def projection(client, mortgage, monthly_payment=None):
    params = {"monthly_payment": monthly_payment} if monthly_payment else {}
    response = client.get(f"/api/mortgages/{mortgage['id']}/projection", params=params)
    assert response.status_code == 200, response.text
    return response.json()


def at(series, months):
    return next(p for p in series["points"] if p["months"] == months)


# Term Changes


def test_a_term_change_starts_on_the_next_accrual_date_by_default(client, mortgage):
    response = change_terms(client, mortgage, monthly_rate_bps=200)

    assert response.status_code == 201, response.text
    updated = response.json()
    [change] = updated["term_changes"]
    assert change["effective_on"] == "2026-05-14"
    # Only the rate was given: the other Terms carry over.
    assert change["terms"] == {**SIMPLE_3, "monthly_rate_bps": 200}
    assert change["removable"] is True
    assert updated["terms"] == SIMPLE_3  # still in force today
    assert updated["outstanding"]["total"] == 1_09_000 * RUPEE


def test_a_term_change_starting_today_shows_in_the_ledger(client, ramesh):
    mortgage = open_mortgage(client, ramesh, start="2026-03-20")  # accrues today

    response = change_terms(
        client, mortgage, effective_on="2026-04-20", interest_mode="compounded_monthly"
    )

    assert response.status_code == 201, response.text
    updated = response.json()
    assert updated["terms"]["interest_mode"] == "compounded_monthly"
    assert updated["ledger"][-1]["event"] == "term_changed"
    assert updated["term_changes"][0]["removable"] is False


@pytest.mark.parametrize(
    ("effective_on", "why"),
    [("2026-05-15", "not an Accrual Date"), ("2026-04-14", "before today")],
)
def test_a_term_change_must_start_on_a_coming_accrual_date(
    client, mortgage, effective_on, why
):
    response = change_terms(
        client, mortgage, effective_on=effective_on, monthly_rate_bps=200
    )

    assert response.status_code == 422, why


def test_a_term_change_must_change_something(client, mortgage):
    assert change_terms(client, mortgage, monthly_rate_bps=300).status_code == 422
    assert change_terms(client, mortgage).status_code == 422


def test_only_one_term_change_per_date(client, mortgage):
    change_terms(client, mortgage, monthly_rate_bps=200)

    assert change_terms(client, mortgage, monthly_rate_bps=250).status_code == 409


def test_a_closed_mortgage_takes_no_term_changes(client, mortgage):
    client.post(
        f"/api/mortgages/{mortgage['id']}/forfeit",
        json={"forfeited_on": "2026-04-20", "recovered_amount": LAKH, "note": ""},
    )

    assert change_terms(client, mortgage, monthly_rate_bps=200).status_code == 409


def test_a_term_change_can_be_removed_until_it_takes_effect(client, ramesh, mortgage):
    change = change_terms(client, mortgage, monthly_rate_bps=200).json()[
        "term_changes"
    ][0]

    response = client.delete(
        f"/api/mortgages/{mortgage['id']}/term-changes/{change['id']}"
    )

    assert response.status_code == 200, response.text
    assert response.json()["term_changes"] == []
    today = open_mortgage(client, ramesh, start="2026-03-20")
    started = change_terms(
        client, today, effective_on="2026-04-20", monthly_rate_bps=200
    ).json()["term_changes"][0]
    assert (
        client.delete(
            f"/api/mortgages/{today['id']}/term-changes/{started['id']}"
        ).status_code
        == 409
    )


def test_term_changes_are_in_the_history(client, mortgage):
    change = change_terms(client, mortgage, monthly_rate_bps=200).json()[
        "term_changes"
    ][0]
    client.delete(f"/api/mortgages/{mortgage['id']}/term-changes/{change['id']}")

    history = client.get(f"/api/mortgages/{mortgage['id']}/history").json()
    actions = [(e["action"], e["field"], e["new_value"]) for e in history]
    assert ("term_change_removed", None, None) in actions
    assert ("term_change_added", "monthly_rate_bps", "200") in actions
    assert ("term_change_added", "effective_on", "2026-05-14") in actions


# Projections


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


def test_each_term_change_keeps_only_its_own_effect(client, mortgage):
    change_terms(
        client, mortgage, effective_on="2026-06-14", interest_mode="compounded_monthly"
    )
    added = change_terms(
        client, mortgage, effective_on="2026-05-14", monthly_rate_bps=200
    ).json()

    may, june = added["term_changes"]
    assert june["terms"] == {
        **SIMPLE_3,
        "monthly_rate_bps": 200,  # the earlier change carries on
        "interest_mode": "compounded_monthly",
    }
    removed = client.delete(
        f"/api/mortgages/{mortgage['id']}/term-changes/{may['id']}"
    ).json()
    assert removed["term_changes"][0]["terms"] == {
        **SIMPLE_3,
        "interest_mode": "compounded_monthly",
    }


def test_a_new_start_date_must_keep_term_changes_on_accrual_dates(client, mortgage):
    change_terms(client, mortgage, monthly_rate_bps=200)  # 14 May

    response = client.put(
        f"/api/mortgages/{mortgage['id']}",
        json={
            "name": mortgage["name"],
            "start_date": "2026-01-15",
            "amount_lent": LAKH,
            "description": mortgage["description"],
            "gross_weight_mg": 20_000,
            "net_weight_mg": 19_000,
            "purity_karat": 22,
        },
    )

    assert response.status_code == 422
    assert "Term Change" in response.json()["detail"]


def test_a_projection_lists_its_coming_term_changes(client, mortgage):
    change_terms(client, mortgage, monthly_rate_bps=200)  # from 14 May

    coming = projection(client, mortgage)["baseline"]["term_changes"]

    assert [(c["on"], c["terms"]["monthly_rate_bps"]) for c in coming] == [
        ("2026-05-14", 200)
    ]
