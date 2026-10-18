"""Term Changes on a running Mortgage (today is 20 Apr 2026)."""

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
    mortgage = lend(client, ramesh, "2026-03-20")  # accrues today

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
    today = lend(client, ramesh, "2026-03-20")
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
