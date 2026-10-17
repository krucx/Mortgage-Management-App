"""The Call List: Mortgages to phone about today (today is 20 Apr 2026, see conftest)."""

import pytest

RUPEE = 100  # paise
LAKH = 1_00_000 * RUPEE


def customer(client, name, phone):
    return client.post(
        "/api/customers",
        json={"name": name, "address": "", "phone_1": phone, "phone_2": None},
    ).json()


def open_mortgage(client, owner, start, net_weight_mg=19_000):
    # ₹1,00,000 at 3% Simple: ₹3,000 interest a month.
    response = client.post(
        "/api/mortgages",
        json={
            "customer_id": owner["id"],
            "start_date": start,
            "amount_lent": LAKH,
            "description": f"Gold chain {start}",
            "gross_weight_mg": net_weight_mg,
            "net_weight_mg": net_weight_mg,
            "purity_karat": 22,
            "terms": {
                "monthly_rate_bps": 300,
                "interest_mode": "simple",
                "part_month_rule": "full_month",
            },
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


def pay(client, owner, mortgage, amount, on="2026-04-20"):
    response = client.post(
        "/api/payments",
        json={
            "customer_id": owner["id"],
            "paid_on": on,
            "amount": amount,
            "method": "cash",
            "allocations": [{"mortgage_id": mortgage["id"], "amount": amount}],
        },
    )
    assert response.status_code == 201, response.text


def call_list(client):
    response = client.get("/api/call-list")
    assert response.status_code == 200, response.text
    return response.json()["items"]


def listed(client):
    """(Mortgage Name, reasons) in Call List order."""
    return [
        (row["mortgage_name"], row["reasons"])
        for group in call_list(client)
        for row in group["rows"]
    ]


@pytest.fixture
def ramesh(client):
    return customer(client, "Ramesh Kumar", "9829012345")


def test_call_list_settings_default_to_3_months_and_85_percent(client):
    assert client.get("/api/settings/call-list").json() == {
        "months_unpaid": 3,
        "loan_to_value_pct": 85,
    }


def test_a_mortgage_with_too_many_months_unpaid_is_listed(client, ramesh):
    three = open_mortgage(client, ramesh, "2026-01-14")  # Feb, Mar, Apr unpaid
    open_mortgage(client, ramesh, "2026-02-10")  # Mar, Apr: not yet

    assert listed(client) == [(three["name"], ["months_unpaid"])]
    assert call_list(client)[0]["rows"][0]["months_unpaid"] == 3


def test_the_most_overdue_are_listed_first(client, ramesh):
    sita = customer(client, "Sita Devi", "9829054321")
    three = open_mortgage(client, ramesh, "2026-01-14")
    four = open_mortgage(client, sita, "2025-12-01")

    assert [name for name, _ in listed(client)] == [four["name"], three["name"]]


def test_paying_the_interest_takes_a_mortgage_off_the_list(client, ramesh):
    mortgage = open_mortgage(client, ramesh, "2026-01-14")

    pay(client, ramesh, mortgage, 9_000 * RUPEE)

    assert listed(client) == []


def test_a_mortgage_with_loan_to_value_too_high_is_listed(client, ramesh):
    client.put(
        "/api/settings/gold-rates",
        json=[{"purity_karat": 22, "rate_per_gram": 6_000 * RUPEE}],
    )
    open_mortgage(client, ramesh, "2026-04-01", net_weight_mg=20_000)  # 1L of 1.2L
    risky = open_mortgage(client, ramesh, "2026-04-02", net_weight_mg=16_000)  # of 96k

    rows = call_list(client)[0]["rows"]
    assert [(r["mortgage_name"], r["reasons"]) for r in rows] == [
        (risky["name"], ["loan_to_value"])
    ]
    assert rows[0]["loan_to_value"] == pytest.approx(LAKH / (96_000 * RUPEE))


def test_a_mortgage_accruing_today_is_listed_for_information(client, ramesh):
    mortgage = open_mortgage(client, ramesh, "2026-03-20")

    assert listed(client) == [(mortgage["name"], ["accrues_today"])]


def test_closed_mortgages_are_not_listed(client, ramesh):
    mortgage = open_mortgage(client, ramesh, "2026-01-14")
    client.post(
        f"/api/mortgages/{mortgage['id']}/forfeit",
        json={"forfeited_on": "2026-04-20", "recovered_amount": LAKH, "note": ""},
    )

    assert listed(client) == []


def test_a_customers_mortgages_are_grouped_with_their_contact_numbers(client, ramesh):
    sita = customer(client, "Sita Devi", "9829054321")
    first = open_mortgage(client, ramesh, "2026-01-14")
    open_mortgage(client, sita, "2026-01-01")
    second = open_mortgage(client, ramesh, "2025-12-14")

    groups = call_list(client)
    assert [g["customer"]["name"] for g in groups] == ["Ramesh Kumar", "Sita Devi"]
    assert groups[0]["phone_1"] == "9829012345"
    assert [r["mortgage_name"] for r in groups[0]["rows"]] == [
        second["name"],
        first["name"],
    ]


def test_a_called_mortgage_stays_listed_but_moves_to_the_bottom(client, ramesh):
    sita = customer(client, "Sita Devi", "9829054321")
    four = open_mortgage(client, ramesh, "2025-12-01")
    three = open_mortgage(client, sita, "2026-01-14")

    response = client.post(
        f"/api/mortgages/{four['id']}/call-notes", json={"note": "Will pay Friday"}
    )

    assert response.status_code == 201, response.text
    rows = [row for group in call_list(client) for row in group["rows"]]
    assert [r["mortgage_name"] for r in rows] == [three["name"], four["name"]]
    assert rows[1]["called"]["note"] == "Will pay Friday"
    assert rows[0]["called"] is None


def test_call_notes_are_kept_on_the_mortgage_newest_first(client, ramesh):
    mortgage = open_mortgage(client, ramesh, "2026-01-14")
    for note in ["No answer", "Will pay Friday"]:
        client.post(f"/api/mortgages/{mortgage['id']}/call-notes", json={"note": note})

    notes = client.get(f"/api/mortgages/{mortgage['id']}/call-notes").json()

    assert [(n["called_on"], n["note"]) for n in notes] == [
        ("2026-04-20", "Will pay Friday"),
        ("2026-04-20", "No answer"),
    ]


def test_the_thresholds_are_settings(client, ramesh):
    two = open_mortgage(client, ramesh, "2026-02-10")

    response = client.put(
        "/api/settings/call-list", json={"months_unpaid": 2, "loan_to_value_pct": 90}
    )

    assert response.status_code == 200, response.text
    assert listed(client) == [(two["name"], ["months_unpaid"])]
