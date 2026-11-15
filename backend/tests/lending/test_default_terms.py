import pytest

DEFAULTS = {
    "monthly_rate_bps": 300,
    "interest_mode": "compounded_yearly",
    "part_month_rule": "full_month",
}


def test_new_database_has_default_terms_of_3_percent_compounded_yearly_full_month(
    client,
):
    response = client.get("/api/settings/default-terms")

    assert response.status_code == 200
    assert response.json() == DEFAULTS


def test_lender_can_change_default_terms_and_they_persist(client):
    new_terms = {
        "monthly_rate_bps": 250,
        "interest_mode": "compounded_monthly",
        "part_month_rule": "pro_rata",
    }

    response = client.put("/api/settings/default-terms", json=new_terms)

    assert response.status_code == 200
    assert response.json() == new_terms
    assert client.get("/api/settings/default-terms").json() == new_terms


@pytest.mark.parametrize(
    "bad_change",
    [
        {"monthly_rate_bps": 0},
        {"monthly_rate_bps": -100},
        {"monthly_rate_bps": 10_001},
        {"monthly_rate_bps": 2.5},
        {"interest_mode": "compounded_daily"},
        {"part_month_rule": "half_month"},
    ],
)
def test_invalid_default_terms_are_rejected_and_nothing_changes(client, bad_change):
    response = client.put(
        "/api/settings/default-terms", json={**DEFAULTS, **bad_change}
    )

    assert response.status_code == 422
    assert client.get("/api/settings/default-terms").json() == DEFAULTS
