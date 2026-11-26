"""Edge cases of the ledger's money math: rounding, day counts, rates, payments and
residuals. The ordinary paths are in test_ledger.py."""

from datetime import date, timedelta

import pytest
from seed import LAKH

from mortgage_backend.lending.ledger import (
    Allocation,
    Overpayment,
    TermChange,
    accrual_date,
    accrual_dates_after,
    compute_ledger,
    days_since_accrual,
    interest_to_date_charge,
    interest_to_date_days,
    is_accrual_date,
    monthly_interest,
)
from mortgage_backend.lending.terms import InterestMode, PartMonthRule, Terms

RUPEE = 100


def terms(bps=300, mode=InterestMode.SIMPLE, rule=PartMonthRule.PRO_RATA):
    return Terms(monthly_rate_bps=bps, interest_mode=mode, part_month_rule=rule)


def last(ledger, event):
    return next(s for s in reversed(ledger) if s.event == event)


# --- rounding to the rupee ---------------------------------------------------------


@pytest.mark.parametrize(
    ("principal", "bps", "days", "rupees"),
    [
        (1, 300, 30, 0),  # one paisa earns nothing
        (0, 300, 30, 0),
        (1_666, 300, 30, 0),  # ₹0.4998 rounds down
        (1_667, 300, 30, 1),  # ₹0.5001 rounds up
        (5_000, 300, 30, 2),  # exactly ₹1.50 rounds half up
        (3_333_334, 150, 30, 500),  # ₹33,333.34 at 1.5%: just over ₹500
        (100, 10_000, 30, 1),  # the 100% ceiling charges the whole principal
        (1, 10_000, 30, 0),
        (LAKH, 1, 30, 10),  # the smallest rate, 0.01% a month
        (50, 1, 30, 0),
    ],
)
def test_a_month_of_interest_rounds_half_up_to_whole_rupees(
    principal, bps, days, rupees
):
    assert monthly_interest(principal, terms(bps), days) == rupees * RUPEE


@pytest.mark.parametrize("principal", [1, 99, 100, 12_345, LAKH, 987_654_321])
@pytest.mark.parametrize("bps", [1, 150, 300, 725, 10_000])
@pytest.mark.parametrize("days", [1, 7, 15, 30])
def test_interest_is_always_whole_rupees_and_within_half_a_rupee_of_exact(
    principal, bps, days
):
    interest = monthly_interest(principal, terms(bps), days)

    assert interest % RUPEE == 0
    exact = principal * bps * days / (10_000 * 30)
    assert abs(interest - exact) <= RUPEE / 2


def test_interest_is_exact_on_a_very_large_principal():
    crore_100 = 100 * 10_000_000 * RUPEE  # ₹100 crore

    assert monthly_interest(crore_100, terms(300)) == 3 * 10_000_000 * RUPEE
    # Python integers do not overflow or lose paise where floats would.
    big = 10**15 + 1
    assert monthly_interest(big, terms(10_000)) == 10**15 + 100 * (
        (1 + 50) // 100
    )  # ₹1 of the extra paisa rounds away


def test_more_days_never_charge_less():
    charges = [monthly_interest(LAKH + 1_234, terms(275), d) for d in range(0, 31)]

    assert charges == sorted(charges)
    assert charges[0] == 0


# --- day counts --------------------------------------------------------------------


@pytest.mark.parametrize(
    ("start", "on", "days"),
    [
        (date(2026, 1, 14), date(2026, 1, 14), 1),  # the start day itself counts
        (date(2026, 1, 14), date(2026, 2, 13), 31),  # day before the first Accrual Date
        (date(2026, 1, 14), date(2026, 2, 14), 1),  # a new month starts that day
        (date(2024, 1, 31), date(2024, 2, 28), 29),  # leap February, one day short
        (date(2024, 1, 31), date(2024, 2, 29), 1),  # Accrual Date is the 29th
        (date(2024, 1, 31), date(2024, 3, 30), 31),  # the next one is the 31st
        (date(2024, 1, 31), date(2024, 3, 31), 1),
        (date(2025, 1, 31), date(2025, 2, 28), 1),
        (date(2025, 1, 31), date(2025, 3, 30), 31),
        (date(2025, 12, 31), date(2026, 1, 31), 1),  # across the year end
        (date(2024, 2, 29), date(2025, 2, 28), 1),  # a leap-day start, next year
        (date(2024, 2, 29), date(2028, 2, 29), 1),
    ],
)
def test_interest_to_date_days_count_from_the_last_accrual_date_inclusive(
    start, on, days
):
    assert interest_to_date_days(start, on) == days
    assert days_since_accrual(start, on) == days - 1


def test_a_month_can_be_31_days_but_pro_rata_charges_at_most_30():
    start = date(2026, 1, 1)
    last_day = date(2026, 1, 31)

    assert interest_to_date_days(start, last_day) == 31
    assert interest_to_date_charge(LAKH, terms(), 31) == interest_to_date_charge(
        LAKH, terms(), 30
    )
    assert interest_to_date_charge(LAKH, terms(), 31) == monthly_interest(LAKH, terms())


@pytest.mark.parametrize(
    ("rule", "days", "expected_rupees"),
    [
        (PartMonthRule.PRO_RATA, 1, 100),  # ₹1,00,000 × 3% × 1/30
        (PartMonthRule.PRO_RATA, 15, 1_500),
        (PartMonthRule.PRO_RATA, 30, 3_000),
        (PartMonthRule.PRO_RATA, 0, 0),
        (PartMonthRule.FULL_MONTH, 1, 3_000),  # a single day pays the whole month
        (PartMonthRule.FULL_MONTH, 0, 0),
        (PartMonthRule.NOTHING, 31, 0),
    ],
)
def test_the_part_month_rule_decides_the_interest_to_date(rule, days, expected_rupees):
    assert interest_to_date_charge(LAKH, terms(rule=rule), days) == (
        expected_rupees * RUPEE
    )


@pytest.mark.parametrize(
    "start", [date(2024, 1, 31), date(2025, 1, 30), date(2026, 1, 1)]
)
def test_accrual_dates_are_strictly_increasing_and_recognised(start):
    dates = [accrual_date(start, n) for n in range(1, 40)]

    assert dates == sorted(set(dates))
    assert all(is_accrual_date(start, d) for d in dates)
    assert not is_accrual_date(start, start)  # the start itself is not one
    assert not is_accrual_date(start, dates[0] + timedelta(days=1))


def test_accrual_dates_after_skip_every_date_up_to_and_including_the_day():
    start = date(2024, 1, 31)

    assert accrual_dates_after(start, date(2024, 2, 29), 2) == [
        date(2024, 3, 31),
        date(2024, 4, 30),
    ]
    assert accrual_dates_after(start, date(2024, 2, 28), 1) == [date(2024, 2, 29)]
    assert accrual_dates_after(start, start, 1) == [date(2024, 2, 29)]


def test_a_leap_day_loan_accrues_on_the_28th_in_common_years_without_drifting():
    ledger = compute_ledger(date(2024, 2, 29), LAKH, terms(), date(2025, 3, 31))
    on = [s.on for s in ledger if s.event == "interest"]

    assert on[0] == date(2024, 3, 29)
    assert date(2025, 2, 28) in on
    assert on[-1] == date(2025, 3, 29)
    assert len(on) == 13


# --- changing and extreme rates ----------------------------------------------------


def test_month_length_never_changes_a_months_simple_charge():
    ledger = compute_ledger(date(2026, 1, 31), LAKH, terms(), date(2027, 1, 31))

    assert [s.amount for s in ledger if s.event == "interest"] == [3_000 * RUPEE] * 12


def test_a_hundred_percent_a_month_doubles_the_debt_each_month_when_compounded():
    ledger = compute_ledger(
        date(2026, 1, 1),
        LAKH,
        terms(10_000, InterestMode.COMPOUNDED_MONTHLY),
        date(2026, 4, 1),
    )

    assert [s.principal for s in ledger if s.event == "capitalised"] == [
        2 * LAKH,
        4 * LAKH,
        8 * LAKH,
    ]


def test_a_rate_change_applies_to_the_months_starting_on_its_accrual_date():
    change = TermChange(on=date(2026, 3, 1), monthly_rate_bps=600)
    ledger = compute_ledger(
        date(2026, 1, 1), LAKH, terms(), date(2026, 5, 1), term_changes=[change]
    )

    # March 1's charge is for February, so still at the old rate.
    assert [
        (s.on.month, s.monthly_rate_bps) for s in ledger if s.event == "interest"
    ] == [(2, 300), (3, 300), (4, 600), (5, 600)]


def test_a_change_to_the_same_terms_leaves_no_term_changed_step():
    change = TermChange(on=date(2026, 3, 1), monthly_rate_bps=300)
    ledger = compute_ledger(
        date(2026, 1, 1), LAKH, terms(), date(2026, 5, 1), term_changes=[change]
    )

    assert all(s.event != "term_changed" for s in ledger)


def test_current_behaviour_a_term_change_dated_off_an_accrual_date_applies_to_the_next_month_started():
    """AMBIGUOUS, documented for the owner: changes.py only lets the Lender date a Term
    Change on an Accrual Date, but the engine itself accepts any date and applies it to
    the first month that starts after it (here March's, charged April 1)."""
    change = TermChange(on=date(2026, 2, 20), monthly_rate_bps=900)
    ledger = compute_ledger(
        date(2026, 1, 1), LAKH, terms(), date(2026, 4, 1), term_changes=[change]
    )

    assert [s.monthly_rate_bps for s in ledger if s.event == "interest"] == [
        300,
        300,
        900,
    ]


# --- payments: early, partial, over, final -----------------------------------------

START = date(2026, 1, 1)
MONTH = 3_000 * RUPEE  # a month's interest on LAKH at 3%
DAY = 100 * RUPEE  # one day of it, pro rata


def paid(as_of, *payments, principal=LAKH, mode=InterestMode.SIMPLE, **allocation):
    allocations = [
        Allocation(on, amount, i + 1, **allocation)
        for i, (on, amount) in enumerate(payments)
    ]
    return compute_ledger(START, principal, terms(mode=mode), as_of, allocations)


def outstanding(ledger):
    return ledger[-1].principal + ledger[-1].unpaid_interest


def test_a_payment_on_the_start_day_first_pays_that_days_interest_to_date():
    ledger = paid(START, (START, 1_000 * RUPEE))

    step = last(ledger, "payment")
    assert (step.interest_paid, step.principal_paid) == (DAY, 1_000 * RUPEE - DAY)


def test_a_payment_of_a_single_paisa_is_applied_to_the_interest_to_date():
    ledger = paid(date(2026, 2, 1), (date(2026, 1, 31), 1))

    assert last(ledger, "payment").interest_paid == 1
    assert last(ledger, "interest").paid_ahead == 1
    assert outstanding(ledger) == LAKH + MONTH + DAY - 1


def test_a_payment_of_exactly_everything_owed_leaves_nothing():
    on = date(2026, 2, 1)

    assert outstanding(paid(on, (on, LAKH + MONTH + DAY))) == 0


def test_a_payment_one_paisa_over_everything_owed_is_an_overpayment():
    on = date(2026, 2, 1)

    with pytest.raises(Overpayment) as raised:
        paid(on, (on, LAKH + MONTH + DAY + 1))

    assert raised.value.outstanding == LAKH + MONTH + DAY


def test_a_discount_of_one_paisa_over_what_cash_leaves_owed_is_an_overpayment():
    on = date(2026, 2, 1)

    with pytest.raises(Overpayment):
        paid(on, (on, LAKH + MONTH + DAY), discount=1)


def test_paying_off_the_principal_early_still_owes_that_months_interest_less_what_was_paid():
    # Interest is charged on the month's starting Principal (ADR 0006): paying
    # ₹1,00,000 + ₹2,000 (20 days, pro rata) on Jan 20 still leaves ₹1,000 of
    # February 1's ₹3,000 owed, and nothing is charged after that.
    ledger = paid(date(2026, 3, 1), (date(2026, 1, 20), LAKH + 2_000 * RUPEE))

    assert [s.amount for s in ledger if s.event == "interest"] == [MONTH, 0]
    assert ledger[-1].principal == 0
    assert outstanding(ledger) == 1_000 * RUPEE


def test_a_final_instalment_clears_the_residual_to_the_last_paisa():
    # Fixed instalments of ₹33,334 on the first two Accrual Dates leave a residual
    # that the last, smaller one must pay exactly.
    first, second, third = (accrual_date(START, n) for n in (1, 2, 3))
    ledger = paid(
        third,
        (first, 33_334 * RUPEE),
        (second, 33_334 * RUPEE),
    )
    residual = outstanding(ledger)  # on `third`, before any final payment

    assert residual > 0
    ledger = paid(
        third,
        (first, 33_334 * RUPEE),
        (second, 33_334 * RUPEE),
        (third, residual),
    )
    assert outstanding(ledger) == 0
    with pytest.raises(Overpayment):
        paid(
            third,
            (first, 33_334 * RUPEE),
            (second, 33_334 * RUPEE),
            (third, residual + 1),
        )


def test_interest_paid_ahead_is_not_charged_again_on_the_accrual_date():
    ledger = paid(date(2026, 2, 1), (date(2026, 1, 16), 1_500 * RUPEE))

    interest = last(ledger, "interest")
    assert interest.amount == MONTH
    assert interest.unpaid_interest == MONTH - 1_500 * RUPEE


def test_payments_on_one_day_are_applied_in_payment_id_order():
    on = date(2026, 2, 5)
    # Supplied in reverse, so the order seen is the engine's, not the input's.
    allocations = [
        Allocation(on, 2_000 * RUPEE, payment_id=2),
        Allocation(on, 1_000 * RUPEE, payment_id=1),
    ]
    ledger = compute_ledger(START, LAKH, terms(), on, allocations)
    payments = [s for s in ledger if s.event == "payment"]

    assert [s.payment_id for s in payments] == [1, 2]
    assert sum(s.amount for s in payments) == 3_000 * RUPEE


@pytest.mark.parametrize("principal", [1, 50, 99, 150])
def test_tiny_principals_accrue_nothing_and_repay_to_exactly_zero(principal):
    on = date(2026, 3, 1)
    ledger = paid(on, (on, principal), principal=principal)

    assert all(s.amount == 0 for s in ledger if s.event == "interest")
    assert outstanding(ledger) == 0


def test_a_very_large_principal_compounds_in_whole_rupees_with_no_float_drift():
    principal = 5_000 * 10_000_000 * RUPEE  # ₹5,000 crore
    ledger = compute_ledger(
        date(2020, 2, 29),
        principal,
        terms(250, InterestMode.COMPOUNDED_MONTHLY),
        date(2030, 3, 1),
    )

    assert all(s.principal % RUPEE == 0 for s in ledger)
    month = principal
    for _ in range(12 * 10):  # Mar 2020 .. Feb 2030
        month += monthly_interest(month, terms(250))
    assert ledger[-1].principal == month
