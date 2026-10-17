"""Before/after previews: what an edit, Term Change or Void would do, without saving
anything (today is 20 Apr 2026, see conftest)."""

import pytest

RUPEE = 100  # paise
LAKH = 1_00_000 * RUPEE


@pytest.fixture
def ramesh(client):
    return client.post(
        "/api/customers",
        json={"name": "Ramesh Kumar", "address": "", "phone_1": "9829012345"},
    ).json()


def details(**overrides):
    # ₹1,00,000 at 3% Simple from 14 Jan: ₹3,000 a month, ₹1,09,000 owed today.
    return {
        "name": "2026-Ramesh-GoldChain",
        "start_date": "2026-01-14",
        "amount_lent": LAKH,
        "description": "Gold chain",
        "gross_weight_mg": 20_000,
        "net_weight_mg": 19_000,
        "purity_karat": 22,
        **overrides,
    }


@pytest.fixture
def mortgage(client, ramesh):
    response = client.post(
        "/api/mortgages",
        json={
            "customer_id": ramesh["id"],
            **details(),
            "terms": {
                "monthly_rate_bps": 300,
                "interest_mode": "simple",
                "part_month_rule": "full_month",
            },
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


@pytest.fixture
def payment(client, ramesh, mortgage):
    response = client.post(
        "/api/payments",
        json={
            "customer_id": ramesh["id"],
            "paid_on": "2026-04-15",
            "amount": 5_000 * RUPEE,
            "method": "cash",
            "allocations": [{"mortgage_id": mortgage["id"], "amount": 5_000 * RUPEE}],
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


def preview(client, path, body=None):
    response = client.post(f"/api/{path}", json=body or {})
    assert response.status_code == 200, response.text
    [only] = response.json()
    return only


def at(side, months):
    return next(p for p in side["points"] if p["months"] == months)


def nothing_saved(client, mortgage):
    saved = client.get(f"/api/mortgages/{mortgage['id']}").json()
    history = client.get(f"/api/mortgages/{mortgage['id']}/history").json()
    return (
        saved["amount_lent"] == LAKH
        and saved["term_changes"] == []
        and all(entry["action"] == "created" for entry in history)
    )


def test_an_edit_preview_shows_both_sides_without_saving(client, mortgage):
    shown = preview(
        client,
        f"mortgages/{mortgage['id']}/edit-preview",
        details(amount_lent=50_000 * RUPEE),
    )

    assert shown["mortgage_name"] == mortgage["name"]
    assert (shown["before"]["outstanding"], shown["after"]["outstanding"]) == (
        1_09_000 * RUPEE,
        54_500 * RUPEE,
    )
    # In 3 months, Redeeming (full-month rule): ₹1,21,000 now, ₹60,500 after.
    assert at(shown["before"], 3)["redemption_amount"] == 1_21_000 * RUPEE
    assert at(shown["after"], 3)["redemption_amount"] == 60_500 * RUPEE
    assert nothing_saved(client, mortgage)


def test_an_edit_preview_lists_the_ledger_steps_that_change(client, mortgage):
    shown = preview(
        client,
        f"mortgages/{mortgage['id']}/edit-preview",
        details(amount_lent=50_000 * RUPEE),
    )

    changed = [
        (c["on"], c["event"], c["before"]["amount"], c["after"]["amount"])
        for c in shown["ledger_changes"]
    ]
    assert changed == [
        ("2026-01-14", "started", LAKH, 50_000 * RUPEE),
        ("2026-02-14", "interest", 3_000 * RUPEE, 1_500 * RUPEE),
        ("2026-03-14", "interest", 3_000 * RUPEE, 1_500 * RUPEE),
        ("2026-04-14", "interest", 3_000 * RUPEE, 1_500 * RUPEE),
    ]


def test_an_edit_that_would_be_refused_cannot_be_previewed(client, payment, mortgage):
    response = client.post(
        f"/api/mortgages/{mortgage['id']}/edit-preview",
        json=details(amount_lent=1_000 * RUPEE),
    )

    assert response.status_code == 422


def test_a_term_change_preview_shows_the_coming_difference(client, mortgage):
    shown = preview(
        client,
        f"mortgages/{mortgage['id']}/term-changes/preview",
        {"monthly_rate_bps": 200},
    )

    # 14 May still 3%; 14 Jun and 14 Jul at 2% instead of 3%.
    assert at(shown["before"], 3)["unpaid_interest"] == 18_000 * RUPEE
    assert at(shown["after"], 3)["unpaid_interest"] == 16_000 * RUPEE
    assert shown["ledger_changes"] == []  # nothing charged so far changes
    assert nothing_saved(client, mortgage)


def test_a_void_preview_shows_the_payment_leaving_the_ledger(client, mortgage, payment):
    shown = preview(client, f"payments/{payment['id']}/void-preview")

    assert (shown["before"]["outstanding"], shown["after"]["outstanding"]) == (
        1_04_000 * RUPEE,
        1_09_000 * RUPEE,
    )
    [change] = shown["ledger_changes"]
    assert (change["event"], change["before"]["amount"], change["after"]) == (
        "payment",
        5_000 * RUPEE,
        None,
    )
    assert client.get(f"/api/payments/{payment['id']}").json()["voided_at"] is None


def test_a_void_preview_is_refused_like_the_void(client, mortgage):
    redeemed = client.post(
        f"/api/mortgages/{mortgage['id']}/redeem",
        json={"redeemed_on": "2026-04-20", "method": "cash"},
    ).json()

    response = client.post(
        f"/api/payments/{redeemed['closure']['payment_id']}/void-preview", json={}
    )

    assert response.status_code == 409


def test_a_void_preview_covers_every_mortgage_the_payment_went_to(
    client, ramesh, mortgage
):
    second = client.post(
        "/api/mortgages",
        json={"customer_id": ramesh["id"], **details(name="2026-Ramesh-Bangles")},
    ).json()
    split = client.post(
        "/api/payments",
        json={
            "customer_id": ramesh["id"],
            "paid_on": "2026-04-15",
            "amount": 4_000 * RUPEE,
            "method": "cash",
            "allocations": [
                {"mortgage_id": mortgage["id"], "amount": 3_000 * RUPEE},
                {"mortgage_id": second["id"], "amount": 1_000 * RUPEE},
            ],
        },
    ).json()

    response = client.post(f"/api/payments/{split['id']}/void-preview", json={})

    assert response.status_code == 200, response.text
    assert [
        (p["mortgage_name"], p["after"]["outstanding"] - p["before"]["outstanding"])
        for p in response.json()
    ] == [
        (mortgage["name"], 3_000 * RUPEE),
        (second["name"], 1_000 * RUPEE),
    ]
