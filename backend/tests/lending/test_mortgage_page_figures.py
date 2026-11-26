"""The figures on a Mortgage's page: its Outstanding includes the Interest to Date
(ADR 0011), while the list's unpaid interest never does. Today is 20 Apr 2026."""

import pytest
from api_seed import SIMPLE_3, lend, pay, person
from seed import LAKH

PRO_RATA = {**SIMPLE_3, "part_month_rule": "pro_rata"}
NOTHING = {**SIMPLE_3, "part_month_rule": "nothing"}
RUPEE = 100


@pytest.fixture
def ramesh(client):
    return person(client)


def page(client, mortgage):
    return client.get(f"/api/mortgages/{mortgage['id']}").json()


def listed(client, mortgage):
    rows = client.get("/api/mortgages").json()
    return next(row for row in rows["items"] if row["id"] == mortgage["id"])


def test_pro_rata_charges_the_days_of_the_month_so_far_today_included(client, ramesh):
    mortgage = lend(client, ramesh, start="2026-04-01", terms=PRO_RATA)

    shown = page(client, mortgage)

    step = shown["ledger"][-1]
    assert (step["event"], step["interest_to_date_days"]) == ("interest_to_date", 20)
    assert shown["outstanding"] == {
        "principal": LAKH,
        "unpaid_interest": 2_000 * RUPEE,  # 20 of 30 days of ₹3,000
        "total": LAKH + 2_000 * RUPEE,
    }
    assert listed(client, mortgage)["unpaid_interest"] == 0


def test_a_mortgage_started_today_owes_one_days_interest_under_pro_rata(client, ramesh):
    mortgage = lend(client, ramesh, start="2026-04-20", terms=PRO_RATA)

    assert page(client, mortgage)["outstanding"]["unpaid_interest"] == 100 * RUPEE


def test_a_mortgage_started_today_owes_no_interest_under_nothing(client, ramesh):
    mortgage = lend(client, ramesh, start="2026-04-20", terms=NOTHING)

    shown = page(client, mortgage)

    assert [s["event"] for s in shown["ledger"]] == ["started"]
    assert shown["outstanding"]["unpaid_interest"] == 0


def test_a_month_end_start_counts_days_from_the_clamped_accrual_date(client, ramesh):
    # Started 31 Jan: accruals on 28 Feb and 31 Mar; the month under way began 31 Mar,
    # so 20 Apr is its 21st day (clamped to 30 days at most, so 21/30 of ₹3,000).
    mortgage = lend(client, ramesh, start="2026-01-31", terms=PRO_RATA)

    shown = page(client, mortgage)

    assert [s["on"] for s in shown["ledger"] if s["event"] == "interest"] == [
        "2026-02-28",
        "2026-03-31",
    ]
    assert shown["ledger"][-1]["interest_to_date_days"] == 21
    assert shown["outstanding"]["unpaid_interest"] == (6_000 + 2_100) * RUPEE


def test_paying_part_of_the_interest_to_date_lowers_the_pages_unpaid_interest(
    client, ramesh
):
    mortgage = lend(client, ramesh, start="2026-04-01", terms=PRO_RATA)
    pay(client, ramesh, {mortgage["id"]: 500 * RUPEE}, on="2026-04-20")

    shown = page(client, mortgage)

    assert shown["outstanding"]["unpaid_interest"] == 1_500 * RUPEE
    assert shown["outstanding"]["principal"] == LAKH
    assert listed(client, mortgage)["unpaid_interest"] == 0


def test_paying_exactly_the_outstanding_leaves_the_page_owing_nothing(client, ramesh):
    mortgage = lend(client, ramesh, start="2026-04-01", terms=PRO_RATA)
    everything = LAKH + 2_000 * RUPEE
    pay(client, ramesh, {mortgage["id"]: everything}, on="2026-04-20")

    assert page(client, mortgage)["outstanding"] == {
        "principal": 0,
        "unpaid_interest": 0,
        "total": 0,
    }


def test_a_payment_one_paisa_over_the_outstanding_is_refused(client, ramesh):
    mortgage = lend(client, ramesh, start="2026-04-01", terms=PRO_RATA)
    over = LAKH + 2_000 * RUPEE + 1

    response = client.post(
        "/api/payments",
        json={
            "customer_id": ramesh["id"],
            "paid_on": "2026-04-20",
            "amount": over,
            "method": "cash",
            "allocations": [{"mortgage_id": mortgage["id"], "amount": over}],
        },
    )

    assert response.status_code == 422, response.text
    assert page(client, mortgage)["outstanding"]["total"] == LAKH + 2_000 * RUPEE
