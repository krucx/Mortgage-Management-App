"""The Discount confirmation threshold: above it, the Lender is asked to confirm before
recording a Discount. A setting, ₹500 unless changed; cleared, there is no confirmation."""


def discount_confirmation_limit(client):
    response = client.get("/api/settings/discount-confirmation-limit")
    assert response.status_code == 200, response.text
    return response.json()


def set_discount_confirmation_limit(client, value):
    response = client.put(
        "/api/settings/discount-confirmation-limit",
        json={"discount_confirmation_limit": value},
    )
    assert response.status_code == 200, response.text
    return response.json()


def test_the_discount_confirmation_limit_is_500_rupees_unless_changed(client):
    assert discount_confirmation_limit(client) == {"discount_confirmation_limit": 500_00}


def test_the_lender_can_change_the_discount_confirmation_limit(client):
    assert set_discount_confirmation_limit(client, 1_000_00) == {
        "discount_confirmation_limit": 1_000_00
    }
    assert discount_confirmation_limit(client) == {"discount_confirmation_limit": 1_000_00}


def test_clearing_the_discount_confirmation_limit_turns_confirmation_off_and_it_stays_off(client):
    assert set_discount_confirmation_limit(client, None) == {"discount_confirmation_limit": None}
    assert discount_confirmation_limit(client) == {"discount_confirmation_limit": None}


def test_a_discount_confirmation_limit_of_zero_is_refused(client):
    response = client.put(
        "/api/settings/discount-confirmation-limit", json={"discount_confirmation_limit": 0}
    )
    assert response.status_code == 422


def test_a_negative_discount_confirmation_limit_is_refused(client):
    response = client.put(
        "/api/settings/discount-confirmation-limit", json={"discount_confirmation_limit": -100}
    )
    assert response.status_code == 422
