"""The ledger engine: a pure calculation, no database (ADR 0001)."""

from datetime import date

import pytest

from mortgage_backend.ledger import (
    Allocation,
    HypotheticalPayments,
    Overpayment,
    TermChange,
    accrual_date,
    compute_ledger,
    months_unpaid,
    terms_on,
)
from mortgage_backend.terms import InterestMode, PartMonthRule, Terms
from seed import LAKH


def terms(mode=InterestMode.SIMPLE, bps=300):
    return Terms(
        monthly_rate_bps=bps,
        interest_mode=mode,
        part_month_rule=PartMonthRule.FULL_MONTH,
    )


def steps(start, principal, as_of, mode=InterestMode.SIMPLE, bps=300):
    """(date, event, amount ₹, Principal ₹, unpaid interest ₹) for readable assertions."""
    return [
        (s.on, s.event, s.amount / 100, s.principal / 100, s.unpaid_interest / 100)
        for s in compute_ledger(start, principal, terms(mode, bps), as_of)
    ]


@pytest.mark.parametrize(
    ("start", "n", "expected"),
    [
        (date(2026, 1, 14), 1, date(2026, 2, 14)),
        (date(2026, 1, 14), 12, date(2027, 1, 14)),
        (date(2024, 1, 31), 1, date(2024, 2, 29)),  # leap year
        (date(2024, 1, 31), 2, date(2024, 3, 31)),  # back to the 31st, not the 29th
        (date(2024, 1, 31), 3, date(2024, 4, 30)),
        (date(2025, 1, 31), 1, date(2025, 2, 28)),
        (date(2025, 1, 30), 1, date(2025, 2, 28)),
        (date(2025, 1, 29), 1, date(2025, 2, 28)),
        (date(2025, 12, 15), 1, date(2026, 1, 15)),
    ],
)
def test_accrual_dates_fall_on_the_start_day_or_month_end(start, n, expected):
    assert accrual_date(start, n) == expected


def test_simple_interest_is_added_a_month_after_the_start_and_every_month_after():
    assert steps(date(2026, 1, 14), LAKH, as_of=date(2026, 4, 14)) == [
        (date(2026, 1, 14), "started", 100_000, 100_000, 0),
        (date(2026, 2, 14), "interest", 3_000, 100_000, 3_000),
        (date(2026, 3, 14), "interest", 3_000, 100_000, 6_000),
        (date(2026, 4, 14), "interest", 3_000, 100_000, 9_000),
    ]


def test_no_interest_before_the_first_accrual_date():
    assert steps(date(2026, 1, 14), LAKH, as_of=date(2026, 2, 13)) == [
        (date(2026, 1, 14), "started", 100_000, 100_000, 0),
    ]


def test_simple_interest_never_capitalises():
    ledger = steps(date(2025, 1, 14), LAKH, as_of=date(2026, 2, 14))

    assert ledger[-1] == (date(2026, 2, 14), "interest", 3_000, 100_000, 39_000)
    assert all(event != "capitalised" for _, event, *_ in ledger)


@pytest.mark.parametrize(
    ("principal_paise", "expected_rupees"),
    [
        (123_456, 37),  # 3% of ₹1,234.56 = ₹37.0368
        (5_000, 2),  # 3% of ₹50 = ₹1.50 → rounds half up
        (4_900, 1),  # 3% of ₹49 = ₹1.47
    ],
)
def test_each_accrual_is_rounded_to_the_nearest_rupee(principal_paise, expected_rupees):
    ledger = steps(date(2026, 1, 1), principal_paise, as_of=date(2026, 2, 1))

    assert ledger[-1][2] == expected_rupees


def test_compounded_yearly_capitalises_unpaid_interest_on_each_anniversary():
    ledger = steps(
        date(2025, 1, 14),
        LAKH,
        as_of=date(2026, 3, 14),
        mode=InterestMode.COMPOUNDED_YEARLY,
    )

    assert ledger[12:] == [
        (date(2026, 1, 14), "interest", 3_000, 100_000, 36_000),
        (date(2026, 1, 14), "capitalised", 36_000, 136_000, 0),
        (date(2026, 2, 14), "interest", 4_080, 136_000, 4_080),
        (date(2026, 3, 14), "interest", 4_080, 136_000, 8_160),
    ]


def test_compounded_monthly_capitalises_on_every_accrual_date():
    ledger = steps(
        date(2026, 1, 14),
        LAKH,
        as_of=date(2026, 4, 14),
        mode=InterestMode.COMPOUNDED_MONTHLY,
    )

    assert ledger == [
        (date(2026, 1, 14), "started", 100_000, 100_000, 0),
        (date(2026, 2, 14), "interest", 3_000, 100_000, 3_000),
        (date(2026, 2, 14), "capitalised", 3_000, 103_000, 0),
        (date(2026, 3, 14), "interest", 3_090, 103_000, 3_090),
        (date(2026, 3, 14), "capitalised", 3_090, 106_090, 0),
        (date(2026, 4, 14), "interest", 3_183, 106_090, 3_183),  # ₹3,182.70 rounds up
        (date(2026, 4, 14), "capitalised", 3_183, 109_273, 0),
    ]


# --- Payments: each Allocation pays unpaid interest first, then Principal.


def paid(start, as_of, allocations, mode=InterestMode.SIMPLE, principal=LAKH):
    """Ledger rows as (date, event, amount ₹, Principal ₹, unpaid ₹), plus payment splits."""
    ledger = compute_ledger(start, principal, terms(mode), as_of, allocations)
    return [
        (s.on, s.event, s.amount / 100, s.principal / 100, s.unpaid_interest / 100)
        + (
            (s.interest_paid / 100, s.principal_paid / 100)
            if s.event == "payment"
            else ()
        )
        for s in ledger
    ]


def test_a_partial_interest_payment_reduces_only_unpaid_interest():
    ledger = paid(
        date(2026, 1, 14),
        date(2026, 3, 20),
        [Allocation(on=date(2026, 3, 20), amount=4_000_00, payment_id=1)],
    )

    assert ledger[-1] == (date(2026, 3, 20), "payment", 4_000, 100_000, 2_000, 4_000, 0)


def test_a_payment_beyond_the_interest_reduces_principal_from_the_next_month():
    # Paid 1 Mar: the month 14 Feb–14 Mar started on ₹1,00,000, so it is still charged
    # on ₹1,00,000; the reduced ₹90,000 is charged from the month starting 14 Mar.
    ledger = paid(
        date(2026, 1, 14),
        date(2026, 4, 14),
        [Allocation(on=date(2026, 3, 1), amount=13_000_00, payment_id=1)],
    )

    assert ledger[2:] == [
        (date(2026, 3, 1), "payment", 13_000, 90_000, 0, 3_000, 10_000),
        (date(2026, 3, 14), "interest", 3_000, 90_000, 3_000),
        (date(2026, 4, 14), "interest", 2_700, 90_000, 5_700),
    ]


def test_paying_principal_the_day_before_an_accrual_date_does_not_skip_that_months_interest():
    ledger = compute_ledger(
        date(2026, 1, 14),
        LAKH,
        terms(),
        date(2026, 3, 14),
        [Allocation(on=date(2026, 3, 13), amount=53_000_00, payment_id=1)],
    )

    interest = ledger[-1]
    assert (interest.event, interest.amount, interest.charged_on) == (
        "interest",
        3_000_00,
        LAKH,
    )


def test_a_payment_on_an_accrual_date_counts_for_the_month_that_starts_then():
    ledger = paid(
        date(2026, 1, 14),
        date(2026, 3, 14),
        [Allocation(on=date(2026, 2, 14), amount=53_000_00, payment_id=1)],
    )

    assert ledger[-1] == (date(2026, 3, 14), "interest", 1_500, 50_000, 1_500)


def test_a_back_dated_payment_is_slotted_in_by_date():
    later = Allocation(on=date(2026, 4, 1), amount=1_000_00, payment_id=1)
    earlier = Allocation(
        on=date(2026, 2, 20), amount=2_000_00, payment_id=2
    )  # entered second

    ledger = paid(date(2026, 1, 14), date(2026, 4, 1), [later, earlier])

    assert [(on, event) for on, event, *_ in ledger] == [
        (date(2026, 1, 14), "started"),
        (date(2026, 2, 14), "interest"),
        (date(2026, 2, 20), "payment"),
        (date(2026, 3, 14), "interest"),
        (date(2026, 4, 1), "payment"),
    ]
    assert ledger[-1][4] == 3_000  # 3,000 + 3,000 − 2,000 − 1,000


def test_a_payment_on_an_accrual_date_comes_after_that_days_interest():
    ledger = paid(
        date(2026, 1, 14),
        date(2026, 2, 14),
        [Allocation(on=date(2026, 2, 14), amount=3_000_00, payment_id=1)],
    )

    assert ledger[1:] == [
        (date(2026, 2, 14), "interest", 3_000, 100_000, 3_000),
        (date(2026, 2, 14), "payment", 3_000, 100_000, 0, 3_000, 0),
    ]


def test_compounded_yearly_capitalises_only_the_unpaid_interest():
    # 5 months' interest (15,000) by 1 Jul; 10,000 paid leaves 5,000 unpaid,
    # then 7 more months (21,000) → 26,000 capitalised on the anniversary.
    ledger = paid(
        date(2025, 1, 14),
        date(2026, 1, 14),
        [Allocation(on=date(2025, 7, 1), amount=10_000_00, payment_id=1)],
        mode=InterestMode.COMPOUNDED_YEARLY,
    )

    assert ledger[-1] == (date(2026, 1, 14), "capitalised", 26_000, 126_000, 0)


def test_paying_on_the_anniversary_avoids_capitalisation():
    ledger = paid(
        date(2025, 1, 14),
        date(2026, 1, 14),
        [Allocation(on=date(2026, 1, 14), amount=36_000_00, payment_id=1)],
        mode=InterestMode.COMPOUNDED_YEARLY,
    )

    assert ledger[-1] == (date(2026, 1, 14), "payment", 36_000, 100_000, 0, 36_000, 0)


def test_a_payment_larger_than_what_is_owed_on_its_date_is_an_overpayment():
    with pytest.raises(Overpayment) as raised:
        compute_ledger(
            date(2026, 1, 14),
            LAKH,
            terms(),
            date(2026, 3, 1),
            [Allocation(on=date(2026, 3, 1), amount=103_000_01, payment_id=7)],
        )

    assert raised.value.payment_id == 7
    assert raised.value.outstanding == 103_000_00


def test_paying_off_everything_leaves_nothing_owed():
    ledger = paid(
        date(2026, 1, 14),
        date(2026, 3, 1),
        [Allocation(on=date(2026, 3, 1), amount=103_000_00, payment_id=1)],
    )

    assert ledger[-1] == (date(2026, 3, 1), "payment", 103_000, 0, 0, 3_000, 100_000)


# --- Closing a Mortgage (Redemption / Forfeiture): the Part-Month Rule, then no more interest.


def closed(start, closed_on, rule, allocations=(), as_of=None, principal=LAKH):
    rule_terms = Terms(
        monthly_rate_bps=300, interest_mode=InterestMode.SIMPLE, part_month_rule=rule
    )
    return compute_ledger(
        start,
        principal,
        rule_terms,
        as_of or closed_on,
        list(allocations),
        closed_on=closed_on,
    )


@pytest.mark.parametrize(
    ("rule", "charge"),
    [
        (PartMonthRule.FULL_MONTH, 3_000_00),
        (PartMonthRule.PRO_RATA, 1_000_00),  # 10 days of 30
        (PartMonthRule.NOTHING, None),
    ],
)
def test_closing_between_accrual_dates_adds_the_part_month_rule_charge(rule, charge):
    # Last Accrual Date 14 Feb, closed 24 Feb: 10 days into the month.
    ledger = closed(date(2026, 1, 14), date(2026, 2, 24), rule)

    last = ledger[-1]
    if charge is None:
        assert last.event == "interest"
        assert last.unpaid_interest == 3_000_00
    else:
        assert (last.on, last.event, last.amount, last.part_month_days) == (
            date(2026, 2, 24),
            "part_month",
            charge,
            10,
        )
        assert last.unpaid_interest == 3_000_00 + charge


@pytest.mark.parametrize("rule", list(PartMonthRule))
def test_closing_on_an_accrual_date_adds_no_part_month_charge(rule):
    ledger = closed(date(2026, 1, 14), date(2026, 3, 14), rule)

    assert [s.event for s in ledger] == ["started", "interest", "interest"]


@pytest.mark.parametrize(
    ("rule", "charge"),
    [(PartMonthRule.FULL_MONTH, 3_000_00), (PartMonthRule.PRO_RATA, 1_000_00)],
)
def test_closing_in_the_first_month_still_follows_the_rule(rule, charge):
    ledger = closed(date(2026, 1, 14), date(2026, 1, 24), rule)

    assert (ledger[-1].event, ledger[-1].amount) == ("part_month", charge)


def test_no_interest_accrues_after_closing():
    ledger = closed(
        date(2026, 1, 14),
        date(2026, 2, 24),
        PartMonthRule.FULL_MONTH,
        as_of=date(2026, 9, 1),
    )

    assert ledger[-1].on == date(2026, 2, 24)


def test_the_part_month_charge_is_on_the_principal_at_the_start_of_that_month():
    # 13,000 paid 20 Feb clears 3,000 interest and 10,000 Principal; the month began on 1,00,000.
    ledger = closed(
        date(2026, 1, 14),
        date(2026, 2, 24),
        PartMonthRule.FULL_MONTH,
        [Allocation(on=date(2026, 2, 20), amount=13_000_00, payment_id=1)],
    )

    assert (ledger[-1].event, ledger[-1].amount, ledger[-1].charged_on) == (
        "part_month",
        3_000_00,
        LAKH,
    )


def test_a_final_payment_on_the_closing_date_can_include_the_part_month_charge():
    ledger = closed(
        date(2026, 1, 14),
        date(2026, 2, 24),
        PartMonthRule.FULL_MONTH,
        [Allocation(on=date(2026, 2, 24), amount=106_000_00, payment_id=1)],
    )

    assert [s.event for s in ledger[-2:]] == ["part_month", "payment"]
    assert (ledger[-1].principal, ledger[-1].unpaid_interest) == (0, 0)


def test_forfeiting_settles_what_was_owed_so_nothing_stays_outstanding():
    rule_terms = Terms(
        monthly_rate_bps=300,
        interest_mode=InterestMode.SIMPLE,
        part_month_rule=PartMonthRule.FULL_MONTH,
    )

    ledger = compute_ledger(
        date(2026, 1, 14),
        LAKH,
        rule_terms,
        date(2026, 9, 1),
        closed_on=date(2026, 2, 24),
        forfeited=True,
    )

    assert [
        (s.event, s.amount, s.principal, s.unpaid_interest) for s in ledger[-2:]
    ] == [
        ("part_month", 3_000_00, LAKH, 6_000_00),
        (
            "forfeited",
            106_000_00,
            0,
            0,
        ),  # the Redemption Amount, settled by the jewellery
    ]


def unpaid_months(mode, as_of, *payments):
    allocations = [Allocation(on, amount, i) for i, (on, amount) in enumerate(payments)]
    return months_unpaid(
        compute_ledger(date(2026, 1, 14), LAKH, terms(mode), as_of, allocations)
    )


def test_nothing_is_unpaid_before_the_first_accrual_date():
    assert unpaid_months(InterestMode.SIMPLE, date(2026, 2, 13)) == 0


def test_each_unpaid_monthly_charge_counts_as_a_month_unpaid():
    assert unpaid_months(InterestMode.SIMPLE, date(2026, 5, 14)) == 4


def test_payments_cover_the_oldest_interest_first():
    # ₹3,000 a month: ₹7,000 covers February and March, part of April
    months = unpaid_months(
        InterestMode.SIMPLE, date(2026, 5, 20), (date(2026, 5, 20), 7_000_00)
    )
    assert months == 2  # April (partly covered) and May


def test_paying_every_month_in_full_leaves_nothing_unpaid():
    paid = [(date(2026, m, 14), 3_000_00) for m in range(2, 6)]
    assert unpaid_months(InterestMode.SIMPLE, date(2026, 5, 20), *paid) == 0


@pytest.mark.parametrize(
    "mode", [InterestMode.COMPOUNDED_MONTHLY, InterestMode.COMPOUNDED_YEARLY]
)
def test_capitalised_interest_still_counts_as_unpaid(mode):
    assert unpaid_months(mode, date(2027, 3, 14)) == 14


def test_a_payment_cannot_cover_interest_not_yet_charged():
    # Paying ₹20,000 off the Principal in month one does not pre-pay later interest.
    months = unpaid_months(
        InterestMode.SIMPLE, date(2026, 4, 14), (date(2026, 2, 1), 20_000_00)
    )
    assert months == 3


# Term Changes: each month is charged under the Terms in force at its start.


def interest_and_capitalisation(ledger):
    return [
        (s.on, s.event, s.amount / 100)
        for s in ledger
        if s.event in ("interest", "capitalised", "term_changed")
    ]


def test_a_rate_change_mid_year_under_compounded_yearly():
    yearly = terms(InterestMode.COMPOUNDED_YEARLY)
    two_percent = terms(InterestMode.COMPOUNDED_YEARLY, bps=200)

    ledger = compute_ledger(
        date(2026, 1, 14),
        LAKH,
        yearly,
        date(2027, 1, 14),
        term_changes=[TermChange(date(2026, 7, 14), monthly_rate_bps=200)],
    )

    steps = interest_and_capitalisation(ledger)
    # Interest charged on 14 Jul is for the month before it: still 3%.
    assert steps[5:8] == [
        (date(2026, 7, 14), "interest", 3_000),
        (date(2026, 7, 14), "term_changed", 0),
        (date(2026, 8, 14), "interest", 2_000),
    ]
    assert steps[-1] == (date(2027, 1, 14), "capitalised", 6 * 3_000 + 6 * 2_000)
    assert ledger[-1].principal == 1_30_000_00
    assert (
        ledger[next(i for i, s in enumerate(ledger) if s.event == "term_changed")].terms
        == two_percent
    )


def test_a_switch_from_simple_to_compounded_monthly():
    monthly = terms(InterestMode.COMPOUNDED_MONTHLY)

    ledger = compute_ledger(
        date(2026, 1, 14),
        LAKH,
        terms(InterestMode.SIMPLE),
        date(2026, 6, 14),
        term_changes=[
            TermChange(date(2026, 4, 14), interest_mode=monthly.interest_mode)
        ],
    )

    assert interest_and_capitalisation(ledger)[3:] == [
        (date(2026, 4, 14), "term_changed", 0),
        (date(2026, 5, 14), "interest", 3_000),
        (date(2026, 5, 14), "capitalised", 12_000),  # the simple months' interest too
        (date(2026, 6, 14), "interest", 3_360),  # 3% of 1,12,000
        (date(2026, 6, 14), "capitalised", 3_360),
    ]


def test_closing_follows_the_part_month_rule_in_force():
    nothing = Terms(
        monthly_rate_bps=300,
        interest_mode=InterestMode.SIMPLE,
        part_month_rule=PartMonthRule.NOTHING,
    )

    ledger = compute_ledger(
        date(2026, 1, 14),
        LAKH,
        terms(),  # full month
        date(2026, 4, 20),
        closed_on=date(2026, 4, 20),
        term_changes=[
            TermChange(date(2026, 3, 14), part_month_rule=nothing.part_month_rule)
        ],
    )

    assert all(step.event != "part_month" for step in ledger)


def test_a_term_change_after_the_date_changes_nothing_yet():
    ledger = compute_ledger(
        date(2026, 1, 14),
        LAKH,
        terms(),
        date(2026, 4, 20),
        term_changes=[TermChange(date(2026, 5, 14), monthly_rate_bps=100)],
    )

    assert ledger == compute_ledger(date(2026, 1, 14), LAKH, terms(), date(2026, 4, 20))


# Hypothetical Payments, for Projections


def test_hypothetical_payments_fall_on_each_accrual_date_until_paid_off():
    ten_thousand = 10_000_00  # 3%: ₹300 a month

    ledger = compute_ledger(
        date(2026, 1, 14),
        ten_thousand,
        terms(),
        date(2026, 6, 14),
        hypothetical=HypotheticalPayments(after=date(2026, 1, 20), amount=6_000_00),
    )

    payments = [(s.on, s.amount / 100) for s in ledger if s.event == "payment"]
    assert payments == [
        (date(2026, 2, 14), 6_000),
        (date(2026, 3, 14), 4_429),  # what was left: ₹4,300 + ₹129 interest
    ]
    assert (ledger[-1].principal, ledger[-1].unpaid_interest) == (0, 0)


def test_hypothetical_payments_start_after_the_given_date():
    ledger = compute_ledger(
        date(2026, 1, 14),
        LAKH,
        terms(),
        date(2026, 5, 14),
        hypothetical=HypotheticalPayments(after=date(2026, 4, 14), amount=5_000_00),
    )

    assert [s.on for s in ledger if s.event == "payment"] == [date(2026, 5, 14)]


def test_term_changes_each_change_only_what_they_say():
    # A rate change, then a later mode change: the later one keeps the new rate.
    changes = [
        TermChange(date(2026, 3, 14), monthly_rate_bps=200),
        TermChange(date(2026, 5, 14), interest_mode=InterestMode.COMPOUNDED_MONTHLY),
    ]

    assert terms_on(terms(), changes, date(2026, 5, 14)) == terms(
        InterestMode.COMPOUNDED_MONTHLY, bps=200
    )
    assert terms_on(terms(), changes[1:], date(2026, 5, 14)) == terms(
        InterestMode.COMPOUNDED_MONTHLY, bps=300
    )
