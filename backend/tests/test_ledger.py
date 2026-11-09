"""The ledger engine: a pure calculation, no database (ADR 0001)."""

from datetime import date

import pytest
from seed import LAKH

from mortgage_backend.lending.ledger import (
    Allocation,
    HypotheticalPayments,
    Overpayment,
    TermChange,
    accrual_date,
    compute_ledger,
    months_unpaid,
    project,
    terms_on,
)
from mortgage_backend.lending.terms import InterestMode, PartMonthRule, Terms


def terms(mode=InterestMode.SIMPLE, bps=300):
    return Terms(
        monthly_rate_bps=bps,
        interest_mode=mode,
        part_month_rule=PartMonthRule.FULL_MONTH,
    )


def steps(start, principal, as_of, mode=InterestMode.SIMPLE, bps=300):
    """(date, event, amount ₹, Principal ₹, unpaid interest ₹) for readable assertions,
    leaving out the Interest to Date at the end (tested on its own below)."""
    return [
        (s.on, s.event, s.amount / 100, s.principal / 100, s.unpaid_interest / 100)
        for s in compute_ledger(start, principal, terms(mode, bps), as_of)
        if s.event != "interest_to_date"
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
    """Ledger rows as (date, event, amount ₹, Principal ₹, unpaid ₹), plus payment
    splits, leaving out the Interest to Date at the end."""
    ledger = compute_ledger(start, principal, terms(mode), as_of, allocations)
    return [
        (s.on, s.event, s.amount / 100, s.principal / 100, s.unpaid_interest / 100)
        + (
            (s.interest_paid / 100, s.principal_paid / 100)
            if s.event == "payment"
            else ()
        )
        for s in ledger
        if s.event != "interest_to_date"
    ]


def test_a_partial_interest_payment_reduces_only_unpaid_interest():
    ledger = paid(
        date(2026, 1, 14),
        date(2026, 3, 20),
        [Allocation(on=date(2026, 3, 20), amount=4_000_00, payment_id=1)],
    )

    assert ledger[-1] == (date(2026, 3, 20), "payment", 4_000, 100_000, 2_000, 4_000, 0)


def test_a_payment_beyond_the_interest_reduces_principal_from_the_next_month():
    # Paid 1 Mar: ₹3,000 charged, then the month 14 Feb–14 Mar's ₹3,000 (Full-month)
    # paid ahead, then ₹7,000 Principal. That month started on ₹1,00,000, so it is still
    # charged on ₹1,00,000; the reduced ₹93,000 is charged from the month starting 14 Mar.
    ledger = paid(
        date(2026, 1, 14),
        date(2026, 4, 14),
        [Allocation(on=date(2026, 3, 1), amount=13_000_00, payment_id=1)],
    )

    assert ledger[2:] == [
        (date(2026, 3, 1), "payment", 13_000, 93_000, 0, 6_000, 7_000),
        (date(2026, 3, 14), "interest", 3_000, 93_000, 0),  # paid ahead
        (date(2026, 4, 14), "interest", 2_790, 93_000, 2_790),
    ]


def test_paying_principal_the_day_before_an_accrual_date_does_not_skip_that_months_interest():
    ledger = compute_ledger(
        date(2026, 1, 14),
        LAKH,
        terms(),
        date(2026, 3, 14),
        [Allocation(on=date(2026, 3, 13), amount=53_000_00, payment_id=1)],
    )

    interest = ledger[-2]  # then the Interest to Date
    assert (interest.event, interest.amount, interest.charged_on) == (
        "interest",
        3_000_00,
        LAKH,
    )


def test_a_payment_on_an_accrual_date_lowers_interest_from_the_next_month():
    # 14 Feb: ₹3,000 charged and the month starting then paid ahead (₹3,000), then
    # ₹47,000 Principal. That month started before the Payment, on ₹1,00,000 (ADR 0006).
    ledger = paid(
        date(2026, 1, 14),
        date(2026, 4, 14),
        [Allocation(on=date(2026, 2, 14), amount=53_000_00, payment_id=1)],
    )

    assert ledger[1:] == [
        (date(2026, 2, 14), "interest", 3_000, 100_000, 3_000),
        (date(2026, 2, 14), "payment", 53_000, 53_000, 0, 6_000, 47_000),
        (date(2026, 3, 14), "interest", 3_000, 53_000, 0),
        (date(2026, 4, 14), "interest", 1_590, 53_000, 1_590),
    ]


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
            [Allocation(on=date(2026, 3, 1), amount=106_000_01, payment_id=7)],
        )

    assert raised.value.payment_id == 7
    assert raised.value.outstanding == 106_000_00  # its Interest to Date included


def test_paying_the_principal_and_charged_interest_pays_the_interest_to_date_first():
    # Interest first: ₹3,000 charged, then this month's ₹3,000, leaving ₹3,000 Principal.
    ledger = compute_ledger(
        date(2026, 1, 14),
        LAKH,
        terms(),
        date(2026, 3, 1),
        [Allocation(on=date(2026, 3, 1), amount=103_000_00, payment_id=1)],
    )

    assert [
        (s.event, s.amount, s.paid_ahead, s.principal, s.unpaid_interest)
        for s in ledger[-2:]
    ] == [
        ("payment", 103_000_00, 3_000_00, 3_000_00, 0),  # ₹3,000 of it paid ahead
        ("interest_to_date", 3_000_00, 3_000_00, 3_000_00, 0),
    ]


def test_a_discount_pays_unpaid_interest_the_interest_to_date_and_principal_in_order():
    # The same order as cash (ADR 0014): ₹3,000 unpaid interest, then this month's
    # ₹3,000 Interest to Date, leaving ₹97,000 of the ₹1,00,000 Principal.
    ledger = compute_ledger(
        date(2026, 1, 14),
        LAKH,
        terms(),
        date(2026, 3, 1),
        [Allocation(on=date(2026, 3, 1), amount=0, payment_id=1, discount=103_000_00)],
    )

    payment = ledger[-2]
    assert (
        payment.event,
        payment.discount,
        payment.paid_ahead,
        payment.discount_interest_paid,
        payment.discount_principal_paid,
        payment.principal,
        payment.unpaid_interest,
    ) == ("payment", 103_000_00, 3_000_00, 6_000_00, 97_000_00, 3_000_00, 0)


# --- Closing a Mortgage (Redemption / Forfeiture): its Interest to Date, then no more interest.


def closed(start, closed_on, rule, allocations=(), as_of=None, principal=LAKH, **closure):
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
        **closure,
    )


@pytest.mark.parametrize(
    ("rule", "charge"),
    [
        (PartMonthRule.FULL_MONTH, 3_000_00),
        (PartMonthRule.PRO_RATA, 1_100_00),  # 11 days of 30
        (PartMonthRule.NOTHING, None),
    ],
)
def test_closing_between_accrual_dates_adds_the_interest_to_date(rule, charge):
    # Last Accrual Date 14 Feb, closed 24 Feb: 14 Feb to 24 Feb is 11 days charged.
    ledger = closed(date(2026, 1, 14), date(2026, 2, 24), rule)

    last = ledger[-1]
    if charge is None:
        assert last.event == "interest"
        assert last.unpaid_interest == 3_000_00
    else:
        assert (last.on, last.event, last.amount, last.interest_to_date_days) == (
            date(2026, 2, 24),
            "interest_to_date",
            charge,
            11,
        )
        assert last.unpaid_interest == 3_000_00 + charge


@pytest.mark.parametrize(
    ("rule", "charge"),
    [
        (PartMonthRule.FULL_MONTH, 3_000_00),
        (PartMonthRule.PRO_RATA, 100_00),  # its first day
        (PartMonthRule.NOTHING, None),
    ],
)
def test_closing_on_an_accrual_date_charges_the_month_starting_then(rule, charge):
    ledger = closed(date(2026, 1, 14), date(2026, 3, 14), rule)

    charges = [(s.event, s.amount) for s in ledger[1:]]
    assert charges == [("interest", 3_000_00), ("interest", 3_000_00)] + (
        [("interest_to_date", charge)] if charge else []
    )


@pytest.mark.parametrize(
    ("rule", "charge"),
    [(PartMonthRule.FULL_MONTH, 3_000_00), (PartMonthRule.PRO_RATA, 1_100_00)],
)
def test_closing_in_the_first_month_still_follows_the_rule(rule, charge):
    ledger = closed(date(2026, 1, 14), date(2026, 1, 24), rule)

    assert (ledger[-1].event, ledger[-1].amount) == ("interest_to_date", charge)


def test_no_interest_accrues_after_closing():
    ledger = closed(
        date(2026, 1, 14),
        date(2026, 2, 24),
        PartMonthRule.FULL_MONTH,
        as_of=date(2026, 9, 1),
    )

    assert ledger[-1].on == date(2026, 2, 24)


def test_the_interest_to_date_is_on_the_principal_at_the_start_of_that_month():
    # 13,000 paid 20 Feb clears 3,000 interest and 10,000 Principal; the month began on 1,00,000.
    ledger = closed(
        date(2026, 1, 14),
        date(2026, 2, 24),
        PartMonthRule.FULL_MONTH,
        [Allocation(on=date(2026, 2, 20), amount=13_000_00, payment_id=1)],
    )

    assert (ledger[-1].event, ledger[-1].amount, ledger[-1].charged_on) == (
        "interest_to_date",
        3_000_00,
        LAKH,
    )


def test_a_final_payment_on_the_closing_date_can_include_the_interest_to_date():
    ledger = closed(
        date(2026, 1, 14),
        date(2026, 2, 24),
        PartMonthRule.FULL_MONTH,
        [Allocation(on=date(2026, 2, 24), amount=106_000_00, payment_id=1)],
        closure="redeemed",
        final_payment=1,
    )

    assert [s.event for s in ledger[-2:]] == ["interest_to_date", "payment"]
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
        closure="forfeited",
    )

    assert [
        (s.event, s.amount, s.principal, s.unpaid_interest) for s in ledger[-2:]
    ] == [
        ("interest_to_date", 3_000_00, LAKH, 6_000_00),
        (
            "forfeited",
            106_000_00,
            0,
            0,
        ),  # the Outstanding, settled by the jewellery
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
    # ₹20,000 in month one pays that month's Interest to Date ahead, then Principal:
    # it covers the month under way, but no later month's interest.
    months = unpaid_months(
        InterestMode.SIMPLE, date(2026, 4, 14), (date(2026, 2, 1), 20_000_00)
    )
    assert months == 2


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

    assert all(step.event != "interest_to_date" for step in ledger)


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
        # what was left: ₹4,600 and ₹138 for the month starting then, paid ahead
        (date(2026, 3, 14), 4_738),
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


# Interest to Date: the month under way, today included (ADR 0011).


def owed(ledger):
    return (ledger[-1].principal + ledger[-1].unpaid_interest) / 100


def open_ledger(rule, as_of, mode=InterestMode.SIMPLE, allocations=()):
    """3% a month on ₹3,000, started 1 Nov 2026."""
    rule_terms = Terms(monthly_rate_bps=300, interest_mode=mode, part_month_rule=rule)
    return compute_ledger(date(2026, 11, 1), 3_000_00, rule_terms, as_of, allocations)


@pytest.mark.parametrize(
    ("rule", "as_of", "outstanding"),
    [
        (PartMonthRule.FULL_MONTH, date(2026, 11, 1), 3090),
        (PartMonthRule.FULL_MONTH, date(2026, 11, 15), 3090),
        (PartMonthRule.FULL_MONTH, date(2026, 11, 30), 3090),
        (PartMonthRule.FULL_MONTH, date(2026, 12, 1), 3180),
        (PartMonthRule.PRO_RATA, date(2026, 11, 1), 3003),
        (PartMonthRule.PRO_RATA, date(2026, 11, 15), 3045),
        (PartMonthRule.PRO_RATA, date(2026, 11, 30), 3090),
        (PartMonthRule.PRO_RATA, date(2026, 12, 1), 3093),
        (PartMonthRule.NOTHING, date(2026, 11, 15), 3000),
        (PartMonthRule.NOTHING, date(2026, 12, 1), 3090),
    ],
)
def test_outstanding_includes_the_interest_to_date_with_today_charged(
    rule, as_of, outstanding
):
    assert owed(open_ledger(rule, as_of)) == outstanding


def test_an_open_ledger_ends_with_the_interest_to_date_on_its_date():
    ledger = open_ledger(PartMonthRule.PRO_RATA, date(2026, 12, 15))

    assert [(s.on, s.event, s.amount) for s in ledger[1:]] == [
        (date(2026, 12, 1), "interest", 90_00),  # November's, charged
        (date(2026, 12, 15), "interest_to_date", 45_00),  # 1-15 Dec
    ]
    assert (ledger[-1].interest_to_date_days, ledger[-1].charged_on) == (15, 3_000_00)


def test_the_interest_to_date_is_on_the_capitalised_principal_and_never_capitalised():
    ledger = open_ledger(
        PartMonthRule.FULL_MONTH, date(2026, 12, 1), InterestMode.COMPOUNDED_MONTHLY
    )

    assert [(s.event, s.amount, s.principal, s.unpaid_interest) for s in ledger[1:]] == [
        ("interest", 90_00, 3_000_00, 90_00),
        ("capitalised", 90_00, 3_090_00, 0),
        ("interest_to_date", 93_00, 3_090_00, 93_00),  # ₹92.70 rounds up
    ]
    assert owed(ledger) == 3183


def test_a_payment_on_an_accrual_date_leaves_the_new_month_charged_on_its_start():
    # ₹1,000 on 1 Dec pays November's ₹90, December's ₹90 ahead and ₹820 Principal;
    # December started before the Payment, on ₹3,000 (ADR 0006).
    ledger = open_ledger(
        PartMonthRule.FULL_MONTH,
        date(2026, 12, 1),
        allocations=[Allocation(on=date(2026, 12, 1), amount=1_000_00, payment_id=1)],
    )

    to_date = ledger[-1]
    assert (to_date.event, to_date.amount, to_date.paid_ahead, to_date.charged_on) == (
        "interest_to_date",
        90_00,
        90_00,
        3_000_00,
    )
    assert owed(ledger) == 2180


@pytest.mark.parametrize(
    ("rule", "owed_after"), [(PartMonthRule.FULL_MONTH, 90), (PartMonthRule.PRO_RATA, 3)]
)
def test_paying_principal_and_charged_interest_on_an_accrual_date_still_owes_the_new_month(
    rule, owed_after
):
    # ₹3,000 from 1 Oct: ₹3,090 on 1 Nov pays October's ₹90 and November's Interest to
    # Date first, so what is left of the Principal is still owed (the loophole of #68).
    rule_terms = Terms(
        monthly_rate_bps=300, interest_mode=InterestMode.SIMPLE, part_month_rule=rule
    )

    ledger = compute_ledger(
        date(2026, 10, 1),
        3_000_00,
        rule_terms,
        date(2026, 11, 1),
        [Allocation(on=date(2026, 11, 1), amount=3_090_00, payment_id=1)],
    )

    assert owed(ledger) == owed_after


@pytest.mark.parametrize(
    ("mode", "outstanding"),
    [(InterestMode.SIMPLE, 3_180_00), (InterestMode.COMPOUNDED_MONTHLY, 3_183_00)],
)
def test_paying_the_outstanding_on_an_accrual_date_closes_the_mortgage_at_nothing(
    mode, outstanding
):
    rule_terms = Terms(
        monthly_rate_bps=300, interest_mode=mode, part_month_rule=PartMonthRule.FULL_MONTH
    )
    quoted = compute_ledger(
        date(2026, 11, 1), 3_000_00, rule_terms, date(2026, 12, 1), closed_on=date(2026, 12, 1)
    )
    final = Allocation(on=date(2026, 12, 1), amount=outstanding, payment_id=1)

    ledger = compute_ledger(
        date(2026, 11, 1),
        3_000_00,
        rule_terms,
        date(2026, 12, 1),
        [final],
        closed_on=date(2026, 12, 1),
        closure="redeemed",
        final_payment=1,
    )

    assert owed(quoted) * 100 == outstanding
    assert (ledger[-1].event, owed(ledger)) == ("payment", 0)


@pytest.mark.parametrize(
    ("rule", "closed_on", "final_payment", "interest_to_date"),
    [
        # Redeemed under the old count: 14 days of pro-rata, not today's 15
        (PartMonthRule.PRO_RATA, date(2026, 11, 15), 3_042_00, 42_00),
        # Redeemed on an Accrual Date, when the new month was not yet charged
        (PartMonthRule.FULL_MONTH, date(2026, 12, 1), 3_090_00, None),
    ],
)
def test_a_redemption_owes_nothing_though_its_final_payment_was_counted_the_old_way(
    rule, closed_on, final_payment, interest_to_date
):
    rule_terms = Terms(
        monthly_rate_bps=300, interest_mode=InterestMode.SIMPLE, part_month_rule=rule
    )

    ledger = compute_ledger(
        date(2026, 11, 1),
        3_000_00,
        rule_terms,
        date(2027, 6, 1),
        [Allocation(on=closed_on, amount=final_payment, payment_id=1)],
        closed_on=closed_on,
        closure="redeemed",
        final_payment=1,
    )

    charged = [s.amount for s in ledger if s.event == "interest_to_date"]
    assert charged == ([interest_to_date] if interest_to_date else [])
    assert owed(ledger) == 0


def test_a_waiver_is_charged_the_whole_interest_to_date():
    rule_terms = Terms(
        monthly_rate_bps=300,
        interest_mode=InterestMode.SIMPLE,
        part_month_rule=PartMonthRule.PRO_RATA,
    )

    ledger = compute_ledger(
        date(2026, 11, 1),
        3_000_00,
        rule_terms,
        date(2026, 11, 15),
        [Allocation(on=date(2026, 11, 15), amount=3_000_00, payment_id=1)],
        closed_on=date(2026, 11, 15),
        closure="waived",
        final_payment=1,
    )

    assert [(s.event, s.amount) for s in ledger[-2:]] == [("payment", 3_000_00), ("waived", 45_00)]


def test_the_interest_to_date_follows_the_terms_of_the_month_under_way():
    # From 1 Dec, 2% and pro-rata: November's interest and the Interest to Date on
    # 30 Nov keep the old Terms; 10 Dec is charged under the new.
    change = TermChange(
        on=date(2026, 12, 1), monthly_rate_bps=200, part_month_rule=PartMonthRule.PRO_RATA
    )

    def to_date(as_of):
        return compute_ledger(
            date(2026, 11, 1), 3_000_00, terms(), as_of, term_changes=[change]
        )[-1].amount

    assert (to_date(date(2026, 11, 30)), to_date(date(2026, 12, 10))) == (90_00, 20_00)


def test_months_unpaid_never_counts_the_interest_to_date():
    for as_of in (date(2026, 11, 1), date(2026, 11, 30)):
        assert months_unpaid(open_ledger(PartMonthRule.FULL_MONTH, as_of)) == 0
    assert months_unpaid(open_ledger(PartMonthRule.FULL_MONTH, date(2026, 12, 1))) == 1


def test_a_projection_owes_the_interest_to_date_on_each_date():
    rule_terms = Terms(
        monthly_rate_bps=300,
        interest_mode=InterestMode.SIMPLE,
        part_month_rule=PartMonthRule.PRO_RATA,
    )

    projected = project(
        date(2026, 11, 1), 3_000_00, rule_terms, [date(2026, 11, 1), date(2026, 12, 1)]
    )

    assert [s.outstanding for s in projected.snapshots] == [3_003_00, 3_093_00]


@pytest.mark.parametrize("mode", [InterestMode.SIMPLE, InterestMode.COMPOUNDED_MONTHLY])
def test_redeeming_after_a_payment_on_the_same_accrual_date_costs_the_outstanding(mode):
    # ₹1,000 on 1 Dec pays November's ₹90 (so nothing capitalises), December's ₹90
    # ahead and ₹820 Principal, so ₹2,180 is owed.
    rule_terms = Terms(
        monthly_rate_bps=300, interest_mode=mode, part_month_rule=PartMonthRule.FULL_MONTH
    )
    earlier = Allocation(on=date(2026, 12, 1), amount=1_000_00, payment_id=1)
    final = Allocation(on=date(2026, 12, 1), amount=2_180_00, payment_id=2)

    def ledger(allocations, **closing):
        return compute_ledger(
            date(2026, 11, 1), 3_000_00, rule_terms, date(2026, 12, 1), allocations, **closing
        )

    quoted = ledger([earlier], closed_on=date(2026, 12, 1))
    redeemed = ledger(
        [earlier, final], closed_on=date(2026, 12, 1), closure="redeemed", final_payment=2
    )

    assert owed(ledger([earlier])) == owed(quoted) == 2180
    assert [(s.event, s.payment_id) for s in redeemed[-2:]] == [
        ("interest_to_date", None),
        ("payment", 2),
    ]
    assert owed(redeemed) == 0


# Payments pay the Interest to Date before Principal (#69).


def paid_on(rule, as_of, *payments, mode=InterestMode.SIMPLE):
    """`open_ledger` with cash Payments of (date, ₹) on ₹3,000 from 1 Nov."""
    allocations = [
        Allocation(on=on, amount=rupees * 100, payment_id=i + 1)
        for i, (on, rupees) in enumerate(payments)
    ]
    return open_ledger(rule, as_of, mode, allocations)


def split(step):
    return (step.event, step.interest_paid / 100, step.principal_paid / 100)


@pytest.mark.parametrize(
    ("rule", "rupees", "interest", "principal", "unpaid_on_1_dec"),
    [
        (PartMonthRule.PRO_RATA, 45, 45, 0, 45),  # 15 days paid ahead
        (PartMonthRule.FULL_MONTH, 90, 90, 0, 0),  # the whole month paid ahead
        (PartMonthRule.PRO_RATA, 1_000, 45, 955, 45),
    ],
)
def test_a_mid_month_payment_pays_the_interest_to_date_before_principal(
    rule, rupees, interest, principal, unpaid_on_1_dec
):
    ledger = paid_on(rule, date(2026, 12, 1), (date(2026, 11, 15), rupees))

    payment = next(s for s in ledger if s.event == "payment")
    november = next(s for s in ledger if s.event == "interest")
    assert split(payment) == ("payment", interest, principal)
    # November is still charged on ₹3,000, what was paid ahead counting against it
    assert (november.amount, november.charged_on) == (90_00, 3_000_00)
    assert november.paid_ahead == interest * 100
    assert november.unpaid_interest == unpaid_on_1_dec * 100


def test_a_month_paid_ahead_counts_as_covered_once_charged():
    full = paid_on(PartMonthRule.FULL_MONTH, date(2026, 12, 1), (date(2026, 11, 15), 90))
    half = paid_on(PartMonthRule.PRO_RATA, date(2026, 12, 1), (date(2026, 11, 15), 45))

    assert (months_unpaid(full), months_unpaid(half)) == (0, 1)


def test_interest_paid_ahead_is_never_capitalised():
    # Compounded monthly, pro-rata: ₹45 paid ahead on 15 Nov, so only the other ₹45 of
    # November's ₹90 is capitalised on 1 Dec.
    ledger = paid_on(
        PartMonthRule.PRO_RATA,
        date(2026, 12, 1),
        (date(2026, 11, 15), 45),
        mode=InterestMode.COMPOUNDED_MONTHLY,
    )

    on_1_dec = [s for s in ledger if s.on == date(2026, 12, 1)]
    assert [(s.event, s.amount, s.principal) for s in on_1_dec] == [
        ("interest", 90_00, 3_000_00),
        ("capitalised", 45_00, 3_045_00),
        ("interest_to_date", 3_00, 3_045_00),  # a day of 3% on ₹3,045: ₹3.05 → ₹3
    ]


def test_interest_paid_ahead_does_not_cover_an_older_capitalised_month():
    # Compounded monthly from 1 Oct: October's ₹90 is capitalised on 1 Nov, so ₹93 on
    # 15 Nov all pays November ahead; October's capitalised interest is still unpaid.
    rule_terms = Terms(
        monthly_rate_bps=300,
        interest_mode=InterestMode.COMPOUNDED_MONTHLY,
        part_month_rule=PartMonthRule.FULL_MONTH,
    )

    ledger = compute_ledger(
        date(2026, 10, 1),
        3_000_00,
        rule_terms,
        date(2026, 12, 1),
        [Allocation(on=date(2026, 11, 15), amount=93_00, payment_id=1)],
    )

    assert months_unpaid(ledger) == 1
