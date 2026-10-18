"""Collateral Value from the Lender's Gold Rates, and Loan-to-Value."""

import pytest

from api_seed import lend, person
from seed import RUPEE


@pytest.fixture
def mortgage(client):
    # ₹1,00,000 at 3% Simple from 14 Jan, 19 g net of 22K; on 20 Apr it owes ₹1,09,000.
    ramesh = person(client)
    return lend(client, ramesh)


def set_rates(client, **rates):
    response = client.put(
        "/api/settings/gold-rates",
        json=[
            {"purity_karat": int(k[1:]), "rate_per_gram": r * RUPEE}
            for k, r in rates.items()
        ],
    )
    assert response.status_code == 200, response.text
    return {r["purity_karat"]: r for r in response.json()}


def collateral_of(client, mortgage):
    return client.get(f"/api/mortgages/{mortgage['id']}").json()["collateral"]


def test_gold_rates_start_unset_for_every_purity(client):
    rates = client.get("/api/settings/gold-rates").json()

    assert [(r["purity_karat"], r["rate_per_gram"]) for r in rates] == [
        (24, None),
        (22, None),
        (20, None),
        (18, None),
        (14, None),
    ]


def test_setting_a_gold_rate_records_the_date_it_changed(client):
    set_rates(client, k22=6_000, k24=6_500)

    rates = set_rates(client, k22=6_100, k24=6_500)  # only 22K changed

    assert rates[22]["rate_per_gram"] == 6_100 * RUPEE
    assert rates[22]["updated_on"] == "2026-04-20"
    assert rates[18] == {"purity_karat": 18, "rate_per_gram": None, "updated_on": None}


def test_a_gold_rate_must_be_positive(client):
    response = client.put(
        "/api/settings/gold-rates", json=[{"purity_karat": 22, "rate_per_gram": 0}]
    )
    assert response.status_code == 422


def test_without_a_gold_rate_there_is_no_collateral_value(client, mortgage):
    set_rates(client, k24=6_500)

    assert collateral_of(client, mortgage) is None


def test_collateral_value_is_net_weight_at_the_gold_rate_for_its_purity(
    client, mortgage
):
    set_rates(client, k22=6_000)

    collateral = collateral_of(client, mortgage)

    assert collateral["value"] == 1_14_000 * RUPEE  # 19 g × ₹6,000
    assert collateral["source"] == "gold_rate"
    assert collateral["set_on"] == "2026-04-20"
    assert collateral["loan_to_value"] == pytest.approx(1_09_000 / 1_14_000)


def test_changing_a_gold_rate_revalues_the_mortgage_at_once(client, mortgage):
    set_rates(client, k22=6_000)
    set_rates(client, k22=5_000)

    assert collateral_of(client, mortgage)["value"] == 95_000 * RUPEE


def test_a_manual_collateral_value_overrides_the_gold_rate(client, mortgage):
    set_rates(client, k22=6_000)

    response = client.put(
        f"/api/mortgages/{mortgage['id']}/collateral",
        json={"value": 1_20_000 * RUPEE},
    )

    assert response.status_code == 200, response.text
    collateral = response.json()["collateral"]
    assert (collateral["value"], collateral["source"], collateral["set_on"]) == (
        1_20_000 * RUPEE,
        "manual",
        "2026-04-20",
    )
    set_rates(client, k22=5_000)
    assert collateral_of(client, mortgage)["value"] == 1_20_000 * RUPEE


def test_clearing_the_manual_value_goes_back_to_the_gold_rate(client, mortgage):
    set_rates(client, k22=6_000)
    client.put(
        f"/api/mortgages/{mortgage['id']}/collateral", json={"value": 1_20_000 * RUPEE}
    )

    client.put(f"/api/mortgages/{mortgage['id']}/collateral", json={"value": None})

    assert collateral_of(client, mortgage)["source"] == "gold_rate"


def test_a_manual_collateral_value_must_be_positive(client, mortgage):
    response = client.put(
        f"/api/mortgages/{mortgage['id']}/collateral", json={"value": 0}
    )
    assert response.status_code == 422
