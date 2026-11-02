"""The Cash Limit: at or above it, the Lender is warned on screen before lending or
receiving cash. A setting, ₹20,000 unless changed; cleared, there is no warning."""


def cash_limit(client):
    response = client.get("/api/settings/cash-limit")
    assert response.status_code == 200, response.text
    return response.json()


def set_cash_limit(client, value):
    response = client.put("/api/settings/cash-limit", json={"cash_limit": value})
    assert response.status_code == 200, response.text
    return response.json()


def test_the_cash_limit_is_20000_rupees_unless_changed(client):
    assert cash_limit(client) == {"cash_limit": 20_000_00}


def test_the_lender_can_change_the_cash_limit(client):
    assert set_cash_limit(client, 10_000_00) == {"cash_limit": 10_000_00}
    assert cash_limit(client) == {"cash_limit": 10_000_00}


def test_clearing_the_cash_limit_turns_the_warning_off_and_it_stays_off(client):
    assert set_cash_limit(client, None) == {"cash_limit": None}
    assert cash_limit(client) == {"cash_limit": None}


def test_a_cash_limit_of_nothing_is_refused(client):
    response = client.put("/api/settings/cash-limit", json={"cash_limit": 0})
    assert response.status_code == 422
