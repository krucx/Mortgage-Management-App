"""Simulations: a made-up Mortgage worked out by the ledger engine, for the Calculator
(today is 20 Apr 2026, see conftest)."""

from datetime import date

import pytest
from api_seed import SIMPLE_3, lend, pay, person
from seed import LAKH, RUPEE
from sqlalchemy import select

from mortgage_backend.lending.ledger import accrual_date
from mortgage_backend.platform.db import make_engine, metadata


def simulate(client, **fields):
    details = {
        "amount_lent": LAKH,
        "start_date": "2026-01-14",
        "closed_on": "2027-01-14",
        "terms": SIMPLE_3,
        **fields,
    }
    return client.post("/api/simulation", json=details)


def simulated(client, **fields):
    response = simulate(client, **fields)
    assert response.status_code == 200, response.text
    return response.json()


@pytest.mark.parametrize("start", ["2026-01-14", "2026-01-31"])
@pytest.mark.parametrize("closed_on", ["2026-02-28", "2026-08-15", "2027-03-31"])
@pytest.mark.parametrize(
    "interest_mode", ["simple", "compounded_yearly", "compounded_monthly"]
)
@pytest.mark.parametrize("part_month_rule", ["full_month", "pro_rata", "nothing"])
def test_a_simulation_owes_what_a_real_mortgage_would_on_closure(
    client, start, closed_on, interest_mode, part_month_rule
):
    terms = {
        "monthly_rate_bps": 250,
        "interest_mode": interest_mode,
        "part_month_rule": part_month_rule,
    }
    mortgage = lend(client, person(client), start=start, amount=LAKH, terms=terms)
    real = client.get(
        f"/api/mortgages/{mortgage['id']}/outstanding-on-closure",
        params={"on": closed_on},
    ).json()

    simulation = simulated(
        client, start_date=start, closed_on=closed_on, amount_lent=LAKH, terms=terms
    )

    assert simulation["on_closure"] == real
    # With no Payments, all it owes beyond the amount lent is the interest it earned.
    assert simulation["interest_earned"] == real["total"] - LAKH


def test_on_closure_it_owes_the_interest_to_date_too(client):
    # ₹3,000 on each of 12 Accrual Dates, and the month from 14 Jan 2027: a full month.
    on_closure = simulated(client)["on_closure"]

    assert on_closure["principal"] == LAKH
    assert on_closure["interest_to_date"] == 3_000 * RUPEE
    assert on_closure["total"] == 1_39_000 * RUPEE


def test_the_interest_earned_by_closed_on_includes_the_interest_to_date(client):
    simulation = simulated(client)

    assert simulation["interest_earned"] == 39_000 * RUPEE
    assert simulation["first_month_interest"] == 3_000 * RUPEE


def test_interest_earned_counts_capitalised_interest_once(client):
    # Compounded Monthly at 1%: 12 months on ₹1,00,000, each charged on the last plus
    # what was capitalised, then the month from 14 Jan 2027 on ₹1,12,684.
    terms = {**SIMPLE_3, "monthly_rate_bps": 100, "interest_mode": "compounded_monthly"}

    simulation = simulated(client, terms=terms)

    assert simulation["interest_earned"] == (12_684 + 1_127) * RUPEE
    assert simulation["on_closure"]["total"] == LAKH + simulation["interest_earned"]


@pytest.mark.parametrize(
    ("interest_mode", "rate"),
    [
        ("simple", 0.24),
        ("compounded_yearly", 0.24),
        ("compounded_monthly", 0.268242),
    ],
)
@pytest.mark.parametrize("part_month_rule", ["full_month", "pro_rata", "nothing"])
def test_the_effective_annual_rate_is_what_100_earns_in_a_year(
    client, interest_mode, rate, part_month_rule
):
    terms = {
        "monthly_rate_bps": 200,
        "interest_mode": interest_mode,
        "part_month_rule": part_month_rule,
    }

    simulation = simulated(client, terms=terms)

    assert simulation["effective_annual_rate"] == pytest.approx(rate, abs=1e-6)


@pytest.mark.parametrize(
    "fields",
    [
        {"amount_lent": 0},
        {"terms": {**SIMPLE_3, "monthly_rate_bps": 0}},
        {"terms": {**SIMPLE_3, "monthly_rate_bps": 10_001}},
        {"closed_on": "2026-01-14"},  # not after the start
        {"closed_on": "2026-01-13"},
        {"closed_on": "2036-01-15"},  # more than ten years on
    ],
)
def test_a_simulation_is_refused_outside_the_limits(client, fields):
    assert simulate(client, **fields).status_code == 422


def test_a_simulation_may_close_ten_years_on(client):
    assert simulate(client, closed_on="2036-01-14").status_code == 200


def everything_stored(database_url):
    """Every row of every table, by table."""
    with make_engine(database_url).connect() as conn:
        return {
            name: conn.execute(select(table)).all()
            for name, table in metadata.tables.items()
        }


def test_a_simulation_stores_nothing(client, database_url):
    ramesh = person(client)
    mortgage = lend(client, ramesh)
    pay(client, ramesh, {mortgage["id"]: 5_000 * RUPEE})
    before = everything_stored(database_url)

    simulated(client)
    simulated(client, start_date="2026-01-31", closed_on="2026-04-20")

    assert everything_stored(database_url) == before


def outstanding_by_date(simulation):
    return {p["on"]: p["outstanding"] for p in simulation["points"]}


def test_the_graph_spans_a_year_from_the_start_by_default(client):
    points = outstanding_by_date(simulated(client))

    assert len(points) == 13  # the start and each Accrual Date for a year
    # A full month is owed from the first day, so ₹3,000 more on each Accrual Date.
    assert points["2026-01-14"] == 1_03_000 * RUPEE
    assert points["2026-07-14"] == 1_21_000 * RUPEE
    assert points["2027-01-14"] == 1_39_000 * RUPEE


def test_the_graph_stretches_to_a_later_closed_on(client):
    points = outstanding_by_date(simulated(client, span_months=3))

    assert list(points)[-1] == "2027-01-14"


def test_the_graph_runs_past_an_earlier_closed_on_and_takes_in_that_date(client):
    points = outstanding_by_date(
        simulated(client, span_months=36, closed_on="2026-08-15")
    )

    assert list(points)[-1] == "2029-01-14"
    assert len(points) == 38
    # 7 Accrual Dates, and the month from 14 Aug in full
    assert points["2026-08-15"] == 1_24_000 * RUPEE


def test_spans_other_than_3_6_12_24_or_36_months_are_refused(client):
    assert simulate(client, span_months=5).status_code == 422


def table(months):
    return [
        (m["on"], m["interest"], m["capitalised"], m["principal"], m["unpaid_interest"])
        for m in months
    ]


def test_the_month_by_month_table_runs_to_closed_on(client):
    terms = {**SIMPLE_3, "part_month_rule": "pro_rata"}

    months = simulated(client, terms=terms, closed_on="2026-03-20")["months"]

    assert table(months) == [
        ("2026-02-14", 3_000 * RUPEE, 0, LAKH, 3_000 * RUPEE),
        ("2026-03-14", 3_000 * RUPEE, 0, LAKH, 6_000 * RUPEE),
        # 14 to 20 Mar: 7 days of 30
        ("2026-03-20", 700 * RUPEE, 0, LAKH, 6_700 * RUPEE),
    ]
    assert [m["interest_to_date_days"] for m in months] == [None, None, 7]


def test_the_table_shows_each_capitalisation(client):
    terms = {**SIMPLE_3, "monthly_rate_bps": 100, "interest_mode": "compounded_monthly"}

    months = simulated(client, terms=terms, closed_on="2026-03-14")["months"]

    assert table(months) == [
        ("2026-02-14", 1_000 * RUPEE, 1_000 * RUPEE, 1_01_000 * RUPEE, 0),
        ("2026-03-14", 1_010 * RUPEE, 1_010 * RUPEE, 1_02_010 * RUPEE, 0),
        # The month from 14 Mar in full, charged on Closed on: never capitalised
        ("2026-03-14", 1_020 * RUPEE, 0, 1_02_010 * RUPEE, 1_020 * RUPEE),
    ]


def accrual_dates(start, until):
    """Each Accrual Date of a Mortgage started on `start`, up to `until`."""
    first = date.fromisoformat(start)
    dates, n = [], 1
    while (on := accrual_date(first, n)) <= date.fromisoformat(until):
        dates.append(on.isoformat())
        n += 1
    return dates


@pytest.mark.parametrize(
    "interest_mode", ["simple", "compounded_yearly", "compounded_monthly"]
)
@pytest.mark.parametrize("part_month_rule", ["full_month", "pro_rata", "nothing"])
def test_a_planned_simulation_owes_what_a_mortgage_with_those_payments_would(
    client, interest_mode, part_month_rule
):
    terms = {
        "monthly_rate_bps": 250,
        "interest_mode": interest_mode,
        "part_month_rule": part_month_rule,
    }
    start, closed_on = "2025-01-31", "2026-04-20"
    lump_sums = [
        {"on": "2025-03-10", "amount": 20_000 * RUPEE},
        {"on": "2025-12-31", "amount": 15_000 * RUPEE},  # an Accrual Date
    ]
    ramesh = person(client)
    mortgage = lend(client, ramesh, start=start, amount=LAKH, terms=terms)
    for lump in lump_sums:
        pay(client, ramesh, {mortgage["id"]: lump["amount"]}, on=lump["on"])
    for on in accrual_dates(start, closed_on):
        pay(client, ramesh, {mortgage["id"]: 2_000 * RUPEE}, on=on)
    real = client.get(
        f"/api/mortgages/{mortgage['id']}/outstanding-on-closure",
        params={"on": closed_on},
    ).json()

    simulation = simulated(
        client,
        start_date=start,
        closed_on=closed_on,
        terms=terms,
        monthly_payment=2_000 * RUPEE,
        lump_sums=lump_sums,
    )

    assert simulation["on_closure"] == real


def test_a_plan_that_pays_it_off_ends_the_simulation_that_day(client):
    # ₹30,000 on each Accrual Date pays the month's interest, the next month's in full
    # ahead, then Principal: ₹76,000 left on 14 Feb, ₹48,280 on 14 Mar, ₹19,728 on
    # 14 Apr, and on 14 May the ₹19,728 with its month's ₹592.
    simulation = simulated(client, monthly_payment=30_000 * RUPEE)

    assert simulation["paid_off_on"] == "2026-05-14"
    assert simulation["on_closure"]["on"] == "2026-05-14"
    assert simulation["on_closure"]["total"] == 0
    assert simulation["interest_earned"] == (3_000 + 3_000 + 2_280 + 1_448 + 592) * RUPEE
    points = outstanding_by_date(simulation)
    assert list(points)[-1] == "2026-05-14"
    assert points["2026-05-14"] == 0


def test_a_plan_paying_it_off_after_closed_on_still_says_when(client):
    simulation = simulated(client, monthly_payment=30_000 * RUPEE, closed_on="2026-03-01")

    assert simulation["paid_off_on"] == "2026-05-14"
    assert simulation["on_closure"]["on"] == "2026-03-01"
    # The month from 14 Feb was paid ahead that day.
    assert simulation["on_closure"]["total"] == 76_000 * RUPEE


def test_a_plan_that_never_pays_it_off_within_ten_years_says_none(client):
    # ₹2,000 a month never keeps up with ₹3,000 of interest.
    simulation = simulated(client, monthly_payment=2_000 * RUPEE)

    assert simulation["paid_off_on"] is None


def test_a_lump_sum_can_pay_it_off(client):
    # On 14 Feb: ₹3,000 of interest, the month's ₹3,000 ahead and the ₹1,00,000.
    simulation = simulated(
        client, lump_sums=[{"on": "2026-02-14", "amount": 1_06_000 * RUPEE}]
    )

    assert simulation["paid_off_on"] == "2026-02-14"
    assert simulation["on_closure"]["total"] == 0


def test_a_lump_sum_after_closed_on_is_ignored(client):
    simulation = simulated(
        client,
        closed_on="2026-03-14",
        lump_sums=[
            {"on": "2026-03-15", "amount": 10_000 * RUPEE},
            {"on": "2026-02-20", "amount": 10_000 * RUPEE},
        ],
    )

    assert [lump["ignored"] for lump in simulation["lump_sums"]] == [
        "after_closed_on",
        None,
    ]
    # 20 Feb's pays 14 Feb's ₹3,000, the month's ₹3,000 ahead and ₹4,000 of Principal;
    # then the month from 14 Mar on ₹96,000.
    assert simulation["on_closure"]["total"] == (96_000 + 2_880) * RUPEE


def test_a_lump_sum_after_the_plan_has_paid_it_off_is_ignored(client):
    simulation = simulated(
        client,
        monthly_payment=30_000 * RUPEE,  # paid off on 14 May
        lump_sums=[{"on": "2026-06-01", "amount": 5_000 * RUPEE}],
    )

    assert simulation["lump_sums"][0]["ignored"] == "after_paid_off"
    assert simulation["paid_off_on"] == "2026-05-14"


def test_a_lump_sum_larger_than_what_is_owed_is_refused_naming_it(client):
    # ₹1,00,000, a month's ₹3,000 ahead and 14 Feb's ₹3,000 are owed on 15 Feb.
    response = simulate(
        client,
        lump_sums=[
            {"on": "2026-02-01", "amount": 1_000 * RUPEE},
            {"on": "2026-02-15", "amount": 1_06_001 * RUPEE},
        ],
    )

    assert response.status_code == 422
    detail = response.json()["detail"]
    assert detail["lump_sum"] == 1
    assert detail["on"] == "2026-02-15"
    assert detail["owed"] == 1_05_000 * RUPEE


@pytest.mark.parametrize(
    "lump", [{"on": "2026-01-13", "amount": RUPEE}, {"on": "2026-02-01", "amount": 0}]
)
def test_a_lump_sum_must_be_over_nothing_and_not_before_the_start(client, lump):
    assert simulate(client, lump_sums=[lump]).status_code == 422


def test_a_monthly_payment_must_be_over_nothing(client):
    assert simulate(client, monthly_payment=0).status_code == 422


def test_planned_payments_are_rows_of_the_table_and_dots_on_the_graph(client):
    simulation = simulated(
        client,
        closed_on="2026-03-14",
        monthly_payment=1_000 * RUPEE,
        lump_sums=[{"on": "2026-02-20", "amount": 10_000 * RUPEE}],
    )

    assert [
        (m["on"], m["interest"], m["paid"], m["principal"], m["unpaid_interest"])
        for m in simulation["months"]
    ] == [
        ("2026-02-14", 3_000 * RUPEE, 0, LAKH, 3_000 * RUPEE),
        ("2026-02-14", 0, 1_000 * RUPEE, LAKH, 2_000 * RUPEE),
        # ₹2,000 of interest, the month's ₹3,000 ahead, then Principal
        ("2026-02-20", 0, 10_000 * RUPEE, 95_000 * RUPEE, 0),
        ("2026-03-14", 3_000 * RUPEE, 0, 95_000 * RUPEE, 0),
        ("2026-03-14", 0, 1_000 * RUPEE, 95_000 * RUPEE, 0),
        # The month from 14 Mar on ₹95,000, ₹1,000 of it paid ahead
        ("2026-03-14", 1_850 * RUPEE, 0, 95_000 * RUPEE, 1_850 * RUPEE),
    ]
    assert [(p["on"], p["amount"]) for p in simulation["payments"]][:3] == [
        ("2026-02-14", 1_000 * RUPEE),
        ("2026-02-20", 10_000 * RUPEE),
        ("2026-03-14", 1_000 * RUPEE),
    ]
    assert "2026-02-20" in outstanding_by_date(simulation)


def test_a_collateral_value_and_loan_to_value_are_returned_when_given(client):
    client.put(
        "/api/settings/gold-rates",
        json=[{"purity_karat": 22, "rate_per_gram": 6_000 * RUPEE}],
    )

    simulation = simulated(client, collateral={"net_weight_mg": 25_000, "purity_karat": 22})

    assert simulation["collateral_value"] == 1_50_000 * RUPEE
    assert simulation["loan_to_value"] == pytest.approx(139_000 / 1_50_000)


def test_a_manual_collateral_value_overrides_the_weight(client):
    simulation = simulated(
        client,
        collateral={
            "net_weight_mg": 25_000,
            "purity_karat": 22,
            "override": 2_00_000 * RUPEE,
        },
    )

    assert simulation["collateral_value"] == 2_00_000 * RUPEE
    assert simulation["loan_to_value"] == pytest.approx(139_000 / 2_00_000)


def test_no_collateral_given_returns_neither_value_nor_ratio(client):
    simulation = simulated(client)

    assert simulation["collateral_value"] is None
    assert simulation["loan_to_value"] is None


def test_a_purity_with_no_gold_rate_gives_no_collateral_value(client):
    simulation = simulated(client, collateral={"net_weight_mg": 25_000, "purity_karat": 18})

    assert simulation["collateral_value"] is None
    assert simulation["loan_to_value"] is None
