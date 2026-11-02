"""What each Preview says the change would write in cash, for the Cash Limit's warning
(GLOSSARY.md): each Payment is one sum, its Final Payments included, and so is each
Mortgage's Principal lent; an edit counts only if it makes a sum cash or larger.
Today is 20 Apr 2026."""

import pytest
from api_seed import lend, pay, person
from seed import LAKH

# A Mortgage of ₹1 lakh from 14 Jan at 3% (Full-month Part-Month Rule): ₹9,000
# charged by 14 Apr, plus ₹3,000 Interest to Date.
OUTSTANDING = LAKH + 12_000_00


@pytest.fixture
def ramesh(client):
    return person(client)


@pytest.fixture
def chain(client, ramesh):
    return lend(client, ramesh)


@pytest.fixture
def ring(client, ramesh):
    return lend(client, ramesh, description="Gold ring", amount=50_000_00)


def cash(client, path, body):
    response = client.post(f"/api/{path}", json=body)
    assert response.status_code == 200, response.text
    return response.json()["cash"]


def payment(ramesh, allocations, method="cash"):
    return {
        "customer_id": ramesh["id"],
        "paid_on": "2026-04-20",
        "amount": sum(allocations.values()),
        "method": method,
        "allocations": [{"mortgage_id": m, "amount": a} for m, a in allocations.items()],
    }


def test_a_payment_in_cash_is_one_sum_across_its_mortgages(client, ramesh, chain, ring):
    asked = payment(ramesh, {chain["id"]: 15_000_00, ring["id"]: 10_000_00})

    assert cash(client, "payments/preview", asked) == [25_000_00]


def test_a_payment_by_upi_is_no_cash(client, ramesh, chain):
    asked = payment(ramesh, {chain["id"]: 25_000_00}, method="upi")

    assert cash(client, "payments/preview", asked) == []


def test_a_payment_that_redeems_is_one_sum_with_its_final_payment(
    client, ramesh, chain, ring
):
    asked = payment(ramesh, {chain["id"]: OUTSTANDING, ring["id"]: 8_000_00})

    assert cash(client, "payments/preview", asked) == [OUTSTANDING + 8_000_00]


def test_redeeming_in_cash_is_its_final_payment(client, chain):
    body = {"redeemed_on": "2026-04-20", "method": "cash"}

    assert cash(client, f"mortgages/{chain['id']}/redeem-preview", body) == [OUTSTANDING]


def test_redeeming_several_judges_each_final_payment_on_its_own(
    client, ramesh, chain
):
    other = lend(client, ramesh)
    # Paid off mid-month: a full month's ₹3,000 is each one's Final Payment.
    pay(client, ramesh, {chain["id"]: 109_000_00}, on="2026-04-15")
    pay(client, ramesh, {other["id"]: 109_000_00}, on="2026-04-20")
    body = {
        "redeemed_on": "2026-04-20",
        "method": "cash",
        "mortgage_ids": [chain["id"], other["id"]],
    }

    assert cash(client, "closures/redeem-preview", body) == [3_000_00, 3_000_00]


@pytest.mark.parametrize(("paid", "sums"), [(108_000_00, [108_000_00]), (0, [])])
def test_waiving_in_cash_is_its_final_payment_if_any(client, chain, paid, sums):
    body = {"waived_on": "2026-04-20", "amount_paid": paid, "method": "cash"}

    assert cash(client, f"mortgages/{chain['id']}/waive-preview", body) == sums


def test_forfeiting_writes_no_cash(client, chain):
    body = {"forfeited_on": "2026-04-20", "recovered_amount": LAKH}

    assert cash(client, f"mortgages/{chain['id']}/forfeit-preview", body) == []


def test_voiding_or_reopening_writes_no_cash(client, ramesh, chain):
    paid = pay(client, ramesh, {chain["id"]: 25_000_00})
    assert cash(client, f"payments/{paid['id']}/void-preview", {}) == []

    redeemed = {"redeemed_on": "2026-04-20", "method": "cash"}
    assert client.post(f"/api/mortgages/{chain['id']}/redeem", json=redeemed).status_code == 200
    assert cash(client, f"mortgages/{chain['id']}/reopen-preview", {}) == []


def new_mortgage(ramesh, lent_through):
    return {
        "customer_id": ramesh["id"],
        "start_date": "2026-04-20",
        "amount_lent": 25_000_00,
        "description": "Gold bangle",
        "gross_weight_mg": 6_000,
        "net_weight_mg": 5_000,
        "purity_karat": 22,
        "lent_through": lent_through,
    }


@pytest.mark.parametrize(("lent_through", "sums"), [("cash", [25_000_00]), ("upi", [])])
def test_a_new_mortgage_lent_in_cash_is_its_principal(
    client, ramesh, lent_through, sums
):
    assert cash(client, "mortgages/preview", new_mortgage(ramesh, lent_through)) == sums


def edit(mortgage, **changes):
    return {
        "name": mortgage["name"],
        "start_date": mortgage["start_date"],
        "amount_lent": mortgage["amount_lent"],
        "description": mortgage["description"],
        "gross_weight_mg": mortgage["gross_weight_mg"],
        "net_weight_mg": mortgage["net_weight_mg"],
        "purity_karat": mortgage["purity_karat"],
        "lent_through": mortgage["lent_through"],
        **changes,
    }


@pytest.mark.parametrize(
    ("lent", "changes", "sums"),
    [
        ("upi", {"lent_through": "cash"}, [LAKH]),  # made cash
        ("cash", {"amount_lent": 120_000_00}, [120_000_00]),  # more of it
        ("cash", {"amount_lent": 80_000_00}, []),  # less of it
        ("cash", {"description": "Gold chain, 2 strands"}, []),  # as it was
        ("upi", {"amount_lent": 120_000_00}, []),  # more, but not cash
    ],
)
def test_an_edit_counts_only_when_it_makes_the_principal_cash_or_larger(
    client, ramesh, lent, changes, sums
):
    mortgage = lend(client, ramesh, lent_through=lent)
    body = edit(mortgage, **changes)

    assert cash(client, f"mortgages/{mortgage['id']}/edit-preview", body) == sums
