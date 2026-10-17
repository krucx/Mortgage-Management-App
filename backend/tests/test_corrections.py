"""Fixing mistakes: Voiding Payments, editing Mortgages, reopening closed ones, and the
audit log of every change (today is 20 Apr 2026, see conftest)."""

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
    # ₹1,00,000 at 3% Simple from 14 Jan: ₹3,000 interest a month.
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


def pay(client, ramesh, mortgage, amount, on="2026-04-15"):
    response = client.post(
        "/api/payments",
        json={
            "customer_id": ramesh["id"],
            "paid_on": on,
            "amount": amount,
            "method": "cash",
            "allocations": [{"mortgage_id": mortgage["id"], "amount": amount}],
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


def void(client, payment, reason="Entered twice"):
    return client.post(f"/api/payments/{payment['id']}/void", json={"reason": reason})


def edit(client, mortgage, **overrides):
    return client.put(f"/api/mortgages/{mortgage['id']}", json=details(**overrides))


def outstanding(client, mortgage):
    return client.get(f"/api/mortgages/{mortgage['id']}").json()["outstanding"]["total"]


def history(client, kind, id_):
    response = client.get(f"/api/{kind}/{id_}/history")
    assert response.status_code == 200, response.text
    return [
        (
            e["entity"],
            e["action"],
            e["field"],
            e["old_value"],
            e["new_value"],
            e["note"],
        )
        for e in response.json()
    ]


# Voiding


def test_a_voided_payment_stays_on_record_but_leaves_the_ledger(
    client, ramesh, mortgage
):
    payment = pay(client, ramesh, mortgage, 5_000 * RUPEE)
    assert outstanding(client, mortgage) == 1_04_000 * RUPEE

    response = void(client, payment)

    assert response.status_code == 200, response.text
    assert (
        response.json()["voided_at"] is not None,
        response.json()["void_reason"],
    ) == (
        True,
        "Entered twice",
    )
    assert outstanding(client, mortgage) == 1_09_000 * RUPEE
    ledger = client.get(f"/api/mortgages/{mortgage['id']}").json()["ledger"]
    assert all(step["event"] != "payment" for step in ledger)
    [listed] = client.get("/api/payments").json()["items"]
    assert listed["voided"] is True


def test_voiding_needs_a_reason(client, ramesh, mortgage):
    payment = pay(client, ramesh, mortgage, 5_000 * RUPEE)

    assert void(client, payment, reason="  ").status_code == 422


def test_a_payment_can_be_voided_only_once(client, ramesh, mortgage):
    payment = pay(client, ramesh, mortgage, 5_000 * RUPEE)
    void(client, payment)

    assert void(client, payment).status_code == 409


def test_the_final_payment_of_a_redemption_is_voided_by_reopening(client, mortgage):
    redeemed = client.post(
        f"/api/mortgages/{mortgage['id']}/redeem",
        json={"redeemed_on": "2026-04-20", "method": "cash"},
    ).json()

    response = void(client, {"id": redeemed["closure"]["payment_id"]})

    assert response.status_code == 409
    assert "reopen" in response.json()["detail"].lower()


def test_payments_to_a_closed_mortgage_cannot_be_voided(client, ramesh, mortgage):
    payment = pay(client, ramesh, mortgage, 5_000 * RUPEE)
    client.post(
        f"/api/mortgages/{mortgage['id']}/forfeit",
        json={"forfeited_on": "2026-04-20", "recovered_amount": LAKH, "note": ""},
    )

    assert void(client, payment).status_code == 409


def test_a_voided_payment_does_not_stop_an_earlier_closing_date(
    client, ramesh, mortgage
):
    void(client, pay(client, ramesh, mortgage, 5_000 * RUPEE, on="2026-04-15"))

    response = client.post(
        f"/api/mortgages/{mortgage['id']}/redeem",
        json={"redeemed_on": "2026-04-10", "method": "cash"},
    )

    assert response.status_code == 200, response.text


# Editing a Mortgage


def test_editing_the_principal_recalculates_the_ledger(client, mortgage):
    response = edit(client, mortgage, amount_lent=50_000 * RUPEE)

    assert response.status_code == 200, response.text
    assert response.json()["outstanding"]["total"] == 54_500 * RUPEE


def test_an_edit_that_would_leave_a_payment_too_large_is_refused(
    client, ramesh, mortgage
):
    pay(client, ramesh, mortgage, 50_000 * RUPEE)

    response = edit(client, mortgage, amount_lent=40_000 * RUPEE)

    assert response.status_code == 422
    assert outstanding(client, mortgage) == 59_000 * RUPEE  # unchanged


def test_the_start_date_cannot_move_past_a_payment(client, ramesh, mortgage):
    pay(client, ramesh, mortgage, 5_000 * RUPEE, on="2026-02-01")

    assert edit(client, mortgage, start_date="2026-02-05").status_code == 422


def test_the_start_date_cannot_be_in_the_future(client, mortgage):
    assert edit(client, mortgage, start_date="2026-05-01").status_code == 422


def test_an_edited_name_must_stay_unique(client, ramesh, mortgage):
    client.post(
        "/api/mortgages",
        json={"customer_id": ramesh["id"], **details(name="2026-Ramesh-Bangles")},
    )

    assert edit(client, mortgage, name="2026-ramesh-bangles").status_code == 409
    assert edit(client, mortgage, name="2026-Ramesh-goldchain").status_code == 200


def test_a_closed_mortgage_keeps_its_numbers_but_its_details_can_change(
    client, mortgage
):
    client.post(
        f"/api/mortgages/{mortgage['id']}/forfeit",
        json={"forfeited_on": "2026-04-20", "recovered_amount": LAKH, "note": ""},
    )

    assert (
        edit(client, mortgage, description="Gold chain, 2 lockets").status_code == 200
    )
    assert edit(client, mortgage, amount_lent=90_000 * RUPEE).status_code == 409
    assert edit(client, mortgage, start_date="2026-01-15").status_code == 409


# Reopening


def test_reopening_a_redemption_voids_its_final_payment(client, mortgage):
    redeemed = client.post(
        f"/api/mortgages/{mortgage['id']}/redeem",
        json={"redeemed_on": "2026-04-20", "method": "cash"},
    ).json()

    response = client.post(
        f"/api/mortgages/{mortgage['id']}/reopen",
        json={"reason": "Not handed back yet"},
    )

    assert response.status_code == 200, response.text
    reopened = response.json()
    assert (reopened["status"], reopened["closure"]) == ("active", None)
    assert reopened["outstanding"]["total"] == 1_09_000 * RUPEE
    final = client.get(f"/api/payments/{redeemed['closure']['payment_id']}").json()
    assert final["void_reason"] == "Not handed back yet"


def test_reopening_a_forfeiture_clears_what_was_recovered(client, mortgage):
    client.post(
        f"/api/mortgages/{mortgage['id']}/forfeit",
        json={"forfeited_on": "2026-04-20", "recovered_amount": LAKH, "note": "sold"},
    )

    reopened = client.post(
        f"/api/mortgages/{mortgage['id']}/reopen", json={"reason": "Customer paid"}
    ).json()

    assert (reopened["status"], reopened["closure"]) == ("active", None)
    assert reopened["outstanding"]["total"] == 1_09_000 * RUPEE


def test_only_a_closed_mortgage_can_be_reopened_and_only_with_a_reason(
    client, mortgage
):
    reopen = f"/api/mortgages/{mortgage['id']}/reopen"
    assert client.post(reopen, json={"reason": "x"}).status_code == 409
    client.post(
        f"/api/mortgages/{mortgage['id']}/forfeit",
        json={"forfeited_on": "2026-04-20", "recovered_amount": LAKH, "note": ""},
    )
    assert client.post(reopen, json={"reason": ""}).status_code == 422


# The audit log


def test_a_mortgages_history_shows_every_change_newest_first(client, ramesh, mortgage):
    edit(client, mortgage, description="Gold chain with locket")
    payment = pay(client, ramesh, mortgage, 5_000 * RUPEE)
    void(client, payment)

    entries = history(client, "mortgages", mortgage["id"])
    changes = [e[:2] for e in entries]  # one row per field: collapse each change
    assert [c for i, c in enumerate(changes) if i == 0 or changes[i - 1] != c] == [
        ("payment", "voided"),
        ("payment", "created"),
        ("mortgage", "edited"),
        ("mortgage", "created"),
    ]
    assert ("payment", "voided", "void_reason", None, "Entered twice", None) in entries
    assert ("payment", "created", "amount", None, "500000", None) in entries
    assert (
        "mortgage",
        "edited",
        "description",
        "Gold chain",
        "Gold chain with locket",
        None,
    ) in entries


def test_a_mortgage_is_recorded_with_the_values_it_was_created_with(client, mortgage):
    created = {
        e[2]: e[4]
        for e in history(client, "mortgages", mortgage["id"])
        if e[1] == "created"
    }

    assert created["amount_lent"] == str(LAKH)
    assert created["start_date"] == "2026-01-14"
    assert created["monthly_rate_bps"] == "300"


def test_closing_and_reopening_are_in_the_history(client, mortgage):
    client.post(
        f"/api/mortgages/{mortgage['id']}/forfeit",
        json={"forfeited_on": "2026-04-20", "recovered_amount": LAKH, "note": ""},
    )
    client.post(f"/api/mortgages/{mortgage['id']}/reopen", json={"reason": "Mistake"})

    actions = [entry[:2] for entry in history(client, "mortgages", mortgage["id"])]
    assert actions[:2] == [("mortgage", "reopened"), ("mortgage", "forfeited")]


def test_a_customers_history_shows_their_edits(client, ramesh):
    client.put(
        f"/api/customers/{ramesh['id']}",
        json={"name": "Ramesh Kumar", "address": "Jaipur", "phone_1": "9829012345"},
    )

    entries = history(client, "customers", ramesh["id"])
    assert entries[0] == ("customer", "edited", "address", "", "Jaipur", None)
    assert ("customer", "created", "phone_1", None, "9829012345", None) in entries
