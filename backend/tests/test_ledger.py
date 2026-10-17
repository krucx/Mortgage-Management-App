"""The ledger engine: a pure calculation, no database (ADR 0001)."""

from datetime import date

import pytest

from mortgage_backend.ledger import accrual_date, compute_ledger
from mortgage_backend.terms import InterestMode, PartMonthRule, Terms

LAKH = 100_000_00  # ₹1,00,000 in paise


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
