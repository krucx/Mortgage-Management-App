"""Lent Through: how a Mortgage's Principal was handed to the Customer (Cash, UPI or
bank transfer); required on new Mortgages, unset ("—") on those made before it."""

from datetime import date

import pytest
from api_seed import lend, person
from seed import add_customer, add_mortgage
from sqlalchemy import update

from mortgage_backend.platform.db import make_engine, mortgage_table


@pytest.fixture
def ramesh(client):
    return person(client)


def shown(client, mortgage_id):
    return client.get(f"/api/mortgages/{mortgage_id}").json()


def history(client, mortgage_id):
    return [
        (entry["action"], entry["field"], entry["old_value"], entry["new_value"])
        for entry in client.get(f"/api/mortgages/{mortgage_id}/history").json()
    ]


def edit_of(mortgage):
    """The Mortgage's details as an edit sends them, leaving Lent Through out."""
    fields = ("name", "start_date", "amount_lent", "description")
    weights = ("gross_weight_mg", "net_weight_mg", "purity_karat")
    return {key: mortgage[key] for key in fields + weights}


def test_a_new_mortgage_records_how_it_was_lent(client, ramesh):
    chain = lend(client, ramesh, lent_through="upi")

    assert shown(client, chain["id"])["lent_through"] == "upi"
    assert ("created", "lent_through", None, "upi") in history(client, chain["id"])


def test_a_new_mortgage_must_say_how_it_was_lent(client, ramesh):
    details = {
        "customer_id": ramesh["id"],
        "start_date": "2026-04-01",
        "amount_lent": 10_000_00,
        "description": "Gold ring",
        "gross_weight_mg": 5_000,
        "net_weight_mg": 4_500,
        "purity_karat": 22,
    }

    response = client.post("/api/mortgages", json=details)

    assert response.status_code == 422
    assert "lent_through" in response.text


def test_cash_above_the_cash_limit_is_lent_all_the_same(client, ramesh):
    # The Cash Limit only warns, on screen: the backend never refuses.
    chain = lend(client, ramesh, amount=1_00_000_00, lent_through="cash")

    assert shown(client, chain["id"])["lent_through"] == "cash"


def test_a_mortgage_made_before_shows_none_until_an_edit_sets_it(client, database_url):
    with make_engine(database_url).begin() as conn:
        mortgage_id = add_mortgage(
            conn, add_customer(conn), start_date=date(2025, 6, 1)
        )
        # As every Mortgage made before Lent Through was asked
        conn.execute(
            update(mortgage_table)
            .where(mortgage_table.c.id == mortgage_id)
            .values(lent_through=None)
        )
    before = shown(client, mortgage_id)
    assert before["lent_through"] is None

    edit = edit_of(before)
    response = client.put(
        f"/api/mortgages/{mortgage_id}", json={**edit, "lent_through": "cash"}
    )

    assert response.status_code == 200, response.text
    assert shown(client, mortgage_id)["lent_through"] == "cash"
    assert ("edited", "lent_through", None, "cash") in history(client, mortgage_id)


def test_an_edit_that_leaves_it_out_keeps_how_it_was_lent(client, ramesh):
    chain = lend(client, ramesh, lent_through="cash")
    edit = edit_of(chain)

    response = client.put(
        f"/api/mortgages/{chain['id']}", json={**edit, "description": "Gold chain, 2"}
    )

    assert response.status_code == 200, response.text
    assert shown(client, chain["id"])["lent_through"] == "cash"
