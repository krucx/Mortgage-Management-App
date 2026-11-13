"""The Grace Period: the days after an Accrual Date within which a Payment may be dated
the day before it, as if paid on time. A setting, 3 days unless set; 0 or cleared, off."""

import pytest
from fastapi.testclient import TestClient

from mortgage_backend.main import create_app


def grace_period(client):
    response = client.get("/api/settings/grace-period")
    assert response.status_code == 200, response.text
    return response.json()


def set_grace_period(client, value):
    response = client.put(
        "/api/settings/grace-period", json={"grace_period_days": value}
    )
    assert response.status_code == 200, response.text
    return response.json()


def test_the_grace_period_is_3_days_unless_set(client):
    assert grace_period(client) == {"grace_period_days": 3}


def test_the_lender_can_set_a_grace_period_and_it_is_kept_after_a_restart(database_url):
    with TestClient(create_app(database_url)) as client:
        assert set_grace_period(client, 5) == {"grace_period_days": 5}

    with TestClient(create_app(database_url)) as client:
        assert grace_period(client) == {"grace_period_days": 5}


def test_clearing_the_grace_period_turns_grace_off_and_it_stays_off_after_a_restart(
    database_url,
):
    with TestClient(create_app(database_url)) as client:
        assert set_grace_period(client, None) == {"grace_period_days": None}

    with TestClient(create_app(database_url)) as client:
        assert grace_period(client) == {"grace_period_days": None}


def test_a_grace_period_of_zero_days_is_the_same_as_none(client):
    set_grace_period(client, 5)

    assert set_grace_period(client, 0) == {"grace_period_days": None}
    assert grace_period(client) == {"grace_period_days": None}


@pytest.mark.parametrize("days", [-1, 1.5, True])
def test_a_grace_period_that_is_not_a_whole_number_of_days_is_refused(client, days):
    set_grace_period(client, 5)

    response = client.put(
        "/api/settings/grace-period", json={"grace_period_days": days}
    )

    assert response.status_code == 422
    assert "The Grace Period must be a whole number of days" in response.text
    assert grace_period(client) == {"grace_period_days": 5}
