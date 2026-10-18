"""Before/after previews: what a change would do, without saving
anything (today is 20 Apr 2026, see conftest)."""

import pytest

from api_seed import lend, pay, person
from seed import LAKH, RUPEE


@pytest.fixture
def ramesh(client):
    return person(client)


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
    return lend(client, ramesh, name="2026-Ramesh-GoldChain")


@pytest.fixture
def payment(client, ramesh, mortgage):
    return pay(client, ramesh, {mortgage["id"]: 5_000 * RUPEE})


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
    # On the Default Terms
    second = lend(client, ramesh, name="2026-Ramesh-Bangles", terms=None)
    split = pay(
        client, ramesh, {mortgage["id"]: 3_000 * RUPEE, second["id"]: 1_000 * RUPEE}
    )

    response = client.post(f"/api/payments/{split['id']}/void-preview", json={})

    assert response.status_code == 200, response.text
    assert [
        (p["mortgage_name"], p["after"]["outstanding"] - p["before"]["outstanding"])
        for p in response.json()
    ] == [
        (mortgage["name"], 3_000 * RUPEE),
        (second["name"], 1_000 * RUPEE),
    ]


def amount(step):
    return step and step["amount"]


def changed_steps(shown):
    """(date, kind, amount before, amount after) of each Ledger step that changes."""
    return [
        (c["on"], c["event"], amount(c["before"]), amount(c["after"]))
        for c in shown["ledger_changes"]
    ]


def test_a_redeem_preview_shows_the_final_payment_closing_the_mortgage(
    client, mortgage
):
    shown = preview(
        client,
        f"mortgages/{mortgage['id']}/redeem-preview",
        {"redeemed_on": "2026-04-20", "method": "cash"},
    )

    assert (shown["before"]["outstanding"], shown["after"]["outstanding"]) == (
        1_09_000 * RUPEE,
        0,
    )
    # The Full-month charge for the 6 days since 14 Apr, then the Redemption Amount.
    assert changed_steps(shown) == [
        ("2026-04-20", "part_month", None, 3_000 * RUPEE),
        ("2026-04-20", "payment", None, 1_12_000 * RUPEE),
    ]
    assert shown["after"]["points"] == []  # a closed Mortgage has no Projection
    assert nothing_saved(client, mortgage)
    assert client.get("/api/payments").json()["total"] == 0


def test_a_redeem_preview_is_refused_like_the_redemption(client, mortgage):
    response = client.post(
        f"/api/mortgages/{mortgage['id']}/redeem-preview",
        json={"redeemed_on": "2026-04-21", "method": "cash"},
    )

    assert response.status_code == 422
    assert "future date" in response.json()["detail"]


def test_a_forfeit_preview_shows_the_jewellery_settling_the_debt(client, mortgage):
    shown = preview(
        client,
        f"mortgages/{mortgage['id']}/forfeit-preview",
        {"forfeited_on": "2026-04-20", "recovered_amount": 1_00_000 * RUPEE},
    )

    assert shown["after"]["outstanding"] == 0
    assert [(on, event) for on, event, *_ in changed_steps(shown)] == [
        ("2026-04-20", "part_month"),
        ("2026-04-20", "forfeited"),
    ]
    assert nothing_saved(client, mortgage)


def test_a_reopen_preview_shows_the_final_payment_voided(client, mortgage):
    client.post(
        f"/api/mortgages/{mortgage['id']}/redeem",
        json={"redeemed_on": "2026-04-20", "method": "cash"},
    )

    shown = preview(client, f"mortgages/{mortgage['id']}/reopen-preview")

    assert (shown["before"]["outstanding"], shown["after"]["outstanding"]) == (
        0,
        1_09_000 * RUPEE,
    )
    assert changed_steps(shown) == [
        ("2026-04-20", "part_month", 3_000 * RUPEE, None),
        ("2026-04-20", "payment", 1_12_000 * RUPEE, None),
    ]
    assert at(shown["after"], 3)["redemption_amount"] == 1_21_000 * RUPEE
    assert client.get(f"/api/mortgages/{mortgage['id']}").json()["status"] == "redeemed"


def test_a_reopen_preview_is_refused_like_reopening(client, mortgage):
    response = client.post(f"/api/mortgages/{mortgage['id']}/reopen-preview", json={})

    assert response.status_code == 409


def test_a_term_change_removal_preview_shows_the_projection_without_it(
    client, mortgage
):
    [change] = client.post(
        f"/api/mortgages/{mortgage['id']}/term-changes",
        json={"monthly_rate_bps": 200},
    ).json()["term_changes"]

    shown = preview(
        client,
        f"mortgages/{mortgage['id']}/term-changes/{change['id']}/remove-preview",
    )

    assert at(shown["before"], 3)["unpaid_interest"] == 16_000 * RUPEE
    assert at(shown["after"], 3)["unpaid_interest"] == 18_000 * RUPEE
    assert [
        c["id"]
        for c in client.get(f"/api/mortgages/{mortgage['id']}").json()["term_changes"]
    ] == [change["id"]]


def payment_of(customer, on, *allocations):
    """A Payment body: `allocations` are (Mortgage, paise) pairs."""
    return {
        "customer_id": customer["id"],
        "paid_on": on,
        "amount": sum(amount for _, amount in allocations),
        "method": "cash",
        "allocations": [{"mortgage_id": m["id"], "amount": a} for m, a in allocations],
    }


def test_a_payment_preview_covers_every_mortgage_it_is_allocated_to(
    client, ramesh, mortgage
):
    # On the Default Terms
    second = lend(client, ramesh, name="2026-Ramesh-Bangles", terms=None)

    response = client.post(
        "/api/payments/preview",
        json=payment_of(
            ramesh,
            "2026-04-15",
            (mortgage, 9_000 * RUPEE),
            (second, 10_000 * RUPEE),
        ),
    )

    assert response.status_code == 200, response.text
    # Each owed ₹1,09,000; ₹9,000 pays interest, ₹10,000 also ₹1,000 of Principal.
    assert [
        (p["mortgage_name"], p["before"]["outstanding"], p["after"]["outstanding"])
        for p in response.json()
    ] == [
        (mortgage["name"], 1_09_000 * RUPEE, 1_00_000 * RUPEE),
        ("2026-Ramesh-Bangles", 1_09_000 * RUPEE, 99_000 * RUPEE),
    ]
    assert client.get("/api/payments").json()["total"] == 0


def test_a_payment_preview_refuses_what_saving_refuses(client, ramesh, mortgage):
    # ₹1,06,000 on 15 Mar pays off everything owed then. ₹5,000 back-dated to 20 Feb
    # would leave less owed on 15 Mar, so the later Payment would be too large.
    pay(client, ramesh, {mortgage["id"]: 1_06_000 * RUPEE}, on="2026-03-15")
    back_dated = payment_of(ramesh, "2026-02-20", (mortgage, 5_000 * RUPEE))

    previewed = client.post("/api/payments/preview", json=back_dated)
    saved = client.post("/api/payments", json=back_dated)

    assert (previewed.status_code, saved.status_code) == (422, 422)
    assert previewed.json()["detail"] == saved.json()["detail"]
    assert "the Payment on 15 Mar 2026 would be more than" in saved.json()["detail"]


def test_a_payment_preview_refuses_more_than_is_owed(client, ramesh, mortgage):
    too_much = payment_of(ramesh, "2026-04-15", (mortgage, 1_10_000 * RUPEE))

    response = client.post("/api/payments/preview", json=too_much)

    assert response.status_code == 422
    assert response.json()["detail"] == (
        "2026-Ramesh-GoldChain: the Payment on 15 Apr 2026 would be more than the "
        "₹1,09,000 owed then"
    )


def test_a_new_mortgage_preview_shows_its_name_terms_and_what_it_would_owe(
    client, ramesh
):
    asked = {"customer_id": ramesh["id"], **details(name=None)}

    preview = client.post("/api/mortgages/preview", json=asked)

    assert preview.status_code == 200, preview.text
    shown = preview.json()
    assert shown["name"] == "2026-Ramesh-GoldChain"
    assert shown["terms"]["interest_mode"] == "compounded_yearly"  # the Default Terms
    # Back-dated to 14 Jan: three months of 3% (capitalised only yearly) owed today.
    assert shown["after"]["outstanding"] == 1_09_000 * RUPEE
    assert len(shown["after"]["points"]) > 1
    assert client.get("/api/mortgages").json()["total"] == 0  # nothing saved


def test_a_new_mortgage_that_would_be_refused_cannot_be_previewed(client, mortgage):
    asked = {"customer_id": mortgage["customer"]["id"], **details()}  # name in use

    assert client.post("/api/mortgages/preview", json=asked).status_code == 409


def test_a_collateral_preview_shows_the_loan_to_value_and_call_list_either_side(
    client, mortgage
):
    client.put(
        "/api/settings/gold-rates",
        json=[{"purity_karat": 22, "rate_per_gram": 7_000 * RUPEE}],
    )  # 19 g: ₹1,33,000 of gold, so ₹1,09,000 owed is 82%

    preview = client.post(
        f"/api/mortgages/{mortgage['id']}/collateral-preview",
        json={"value": 1_20_000 * RUPEE},
    ).json()

    assert preview["before"]["value"] == 1_33_000 * RUPEE
    assert preview["after"]["value"] == 1_20_000 * RUPEE
    assert preview["after"]["loan_to_value"] == pytest.approx(109 / 120)
    assert (preview["listed_before"], preview["listed_after"]) == (False, True)
    stored = client.get(f"/api/mortgages/{mortgage['id']}").json()["collateral"]
    assert stored["source"] == "gold_rate"  # nothing saved
