"""The Mortgage replay: a Mortgage's stored facts replayed into its Ledger and
Outstanding, straight against the database (no HTTP). Today is 20 Apr 2026 (see
conftest).

The Mortgage throughout: ₹1,00,000 at 3% a month, Simple, Full-month rule, from
14 Jan 2026, so ₹3,000 of interest on each Accrual Date and, with the month starting
14 Apr already charged as its Interest to Date, ₹1,12,000 owed on 20 Apr.
"""

from datetime import date

from conftest import TODAY
from seed import (
    LAKH,
    RUPEE,
    add_customer,
    add_mortgage,
    add_payment,
    add_term_change,
    forfeit,
    redeem,
    waive,
)
from sqlalchemy import update
from sqlalchemy.engine import Connection

from mortgage_backend.lending.ledger import HypotheticalPayments
from mortgage_backend.lending.replay import Closure, replay, replays
from mortgage_backend.lending.terms import Terms
from mortgage_backend.platform.db import allocation_table, payment_table


def test_a_voided_payment_is_in_no_ledger(conn: Connection) -> None:
    ramesh = add_customer(conn)
    chain = add_mortgage(conn, ramesh)
    add_payment(conn, ramesh, date(2026, 4, 15), {chain: 2_000 * RUPEE})
    add_payment(conn, ramesh, date(2026, 4, 16), {chain: 5_000 * RUPEE}, voided=True)

    mortgage = replay(conn, chain)

    assert mortgage.outstanding(TODAY).total == 1_10_000 * RUPEE
    assert [s.amount for s in mortgage.ledger(TODAY) if s.event == "payment"] == [
        2_000 * RUPEE
    ]


def test_a_outstanding_on_closure_adds_the_interest_to_date(
    conn: Connection,
) -> None:
    chain = add_mortgage(conn, add_customer(conn))

    # 14 to 20 Apr is 7 days of the month: a full month's ₹3,000 under Full-month.
    quote = replay(conn, chain).outstanding_on_closure(TODAY)

    assert quote.interest_to_date_days == 7
    assert quote.interest_to_date == 3_000 * RUPEE
    assert quote.total == 1_12_000 * RUPEE


def test_a_redeemed_mortgage_owes_nothing_and_accrues_nothing_after(
    conn: Connection,
) -> None:
    ramesh = add_customer(conn)
    chain = add_mortgage(conn, ramesh)
    # Redeemed on the 14 Mar Accrual Date: two months' interest and the one starting then.
    redeem(conn, chain, date(2026, 3, 14))

    mortgage = replay(conn, chain)

    assert mortgage.outstanding(TODAY).total == 0
    assert mortgage.ledger(TODAY)[-1].on == date(2026, 3, 14)


def test_a_mortgage_redeemed_under_the_old_day_count_still_owes_nothing(
    conn: Connection,
) -> None:
    pro_rata = Terms(
        monthly_rate_bps=300, interest_mode="simple", part_month_rule="pro_rata"
    )
    chain = add_mortgage(conn, add_customer(conn), terms=pro_rata)
    final = redeem(conn, chain, date(2026, 3, 20))
    # Before ADR 0011, 14 to 20 Mar counted 6 days, not 7: the Final Payment was ₹100 less.
    for table, key in ((payment_table, "id"), (allocation_table, "payment_id")):
        conn.execute(
            update(table)
            .where(table.c[key] == final)
            .values(amount=table.c.amount - 100 * RUPEE)
        )

    mortgage = replay(conn, chain)

    assert mortgage.outstanding(TODAY).total == 0
    to_date = [s for s in mortgage.ledger(TODAY) if s.event == "interest_to_date"]
    assert [s.amount for s in to_date] == [600 * RUPEE]


def test_the_outstanding_on_a_closure_date_leaves_out_its_own_final_payment(
    conn: Connection,
) -> None:
    ramesh = add_customer(conn)
    chain = add_mortgage(conn, ramesh)
    add_payment(conn, ramesh, date(2026, 2, 20), {chain: 1_000 * RUPEE})
    final = redeem(conn, chain, date(2026, 3, 14))
    assert final is not None
    assert replay(conn, chain).steps_by_payment()[final].amount == 1_08_000 * RUPEE

    # Owed on 14 Mar before the final Payment: ₹1,09,000 less the earlier ₹1,000.
    assert replay(conn, chain).outstanding_on_closure(date(2026, 3, 14)).total == 1_08_000 * RUPEE


def test_a_forfeited_mortgage_accrues_nothing_after_and_its_debt_is_settled(
    conn: Connection,
) -> None:
    chain = add_mortgage(conn, add_customer(conn))
    # Forfeited 6 days after the 14 Mar Accrual Date: ₹6,000 of interest plus a full
    # month's ₹3,000 under the Full-month rule, and nothing on 14 Apr.
    forfeit(conn, chain, date(2026, 3, 20), recovered=90_000 * RUPEE)

    mortgage = replay(conn, chain)

    assert mortgage.outstanding(TODAY).total == 0
    ledger = mortgage.ledger(TODAY)
    assert all(step.on <= date(2026, 3, 20) for step in ledger)
    forfeited = ledger[-1]
    assert (forfeited.event, forfeited.amount) == ("forfeited", 1_09_000 * RUPEE)
    # What the Mortgage owed when it was Forfeited.
    assert mortgage.outstanding_on_closure(date(2026, 3, 20)).total == 1_09_000 * RUPEE


def test_a_waived_mortgage_closure_has_its_final_payment_and_what_was_let_off(
    conn: Connection,
) -> None:
    chain = add_mortgage(conn, add_customer(conn))
    # ₹1,09,000 owed on 20 Mar (as above); the Customer pays ₹1,08,000.
    final = waive(conn, chain, date(2026, 3, 20), paid=1_08_000 * RUPEE)

    assert replay(conn, chain).closure() == Closure(
        kind="waived",
        on=date(2026, 3, 20),
        outstanding=1_09_000 * RUPEE,
        interest_to_date=3_000 * RUPEE,  # 14 to 20 Mar, a month charged in full
        interest_to_date_days=7,
        payment_id=final,
        payment_amount=1_08_000 * RUPEE,
        waived_amount=1_000 * RUPEE,
        recovered_amount=None,
        profit_loss=None,
        note="Old friend",
    )


def test_a_forfeited_mortgage_closure_has_its_profit_or_loss(conn: Connection) -> None:
    chain = add_mortgage(conn, add_customer(conn))
    # ₹1,09,000 owed on 20 Mar; the jewellery fetches ₹90,000, a loss of ₹19,000.
    forfeit(conn, chain, date(2026, 3, 20), recovered=90_000 * RUPEE)

    closure = replay(conn, chain).closure()

    assert closure is not None
    assert (closure.kind, closure.payment_id, closure.payment_amount) == (
        "forfeited",
        None,
        None,
    )
    assert (closure.recovered_amount, closure.profit_loss) == (
        90_000 * RUPEE,
        -19_000 * RUPEE,
    )
    assert closure.waived_amount is None


def test_an_active_mortgage_has_no_closure(conn: Connection) -> None:
    assert replay(conn, add_mortgage(conn, add_customer(conn))).closure() is None


def test_term_changes_apply_from_their_accrual_date(conn: Connection) -> None:
    chain = add_mortgage(conn, add_customer(conn))
    add_term_change(conn, chain, date(2026, 3, 14), monthly_rate_bps=200)

    mortgage = replay(conn, chain)

    # ₹3,000 on 14 Feb and 14 Mar, then ₹2,000 for the month starting 14 Mar and
    # ₹2,000 Interest to Date for the one starting 14 Apr.
    assert mortgage.outstanding(TODAY).total == 1_10_000 * RUPEE
    assert mortgage.terms_on(TODAY).monthly_rate_bps == 200
    assert mortgage.terms_on(date(2026, 3, 13)).monthly_rate_bps == 300


def test_mortgages_are_replayed_together_each_with_only_its_own_facts(
    conn: Connection,
) -> None:
    ramesh = add_customer(conn)
    chain = add_mortgage(conn, ramesh)
    bangle = add_mortgage(conn, ramesh, suffix="Bangle", amount_lent=50_000 * RUPEE)
    add_payment(
        conn, ramesh, date(2026, 4, 15), {chain: 4_000 * RUPEE, bangle: 1_000 * RUPEE}
    )

    rows = [replay(conn, chain).row, replay(conn, bangle).row]
    both = replays(conn, rows)

    assert both[chain].outstanding(TODAY).total == 1_08_000 * RUPEE
    # ₹50,000 with ₹1,500 a month for three months and this one, less ₹1,000.
    assert both[bangle].outstanding(TODAY).total == 55_000 * RUPEE


def test_a_projection_reports_each_chosen_date_in_one_replay(conn: Connection) -> None:
    chain = add_mortgage(conn, add_customer(conn))
    add_term_change(conn, chain, date(2026, 6, 14), monthly_rate_bps=200)

    projected = replay(conn, chain).projection([TODAY, date(2026, 7, 20)])

    today, july = projected.snapshots
    # Today: ₹1,09,000 owed, plus a full month's ₹3,000 if Redeemed.
    assert (today.on, today.principal, today.unpaid_interest) == (
        TODAY,
        LAKH,
        9_000 * RUPEE,
    )
    assert today.outstanding == 1_12_000 * RUPEE
    # 14 May and 14 Jun at 3% (each charges the month before), 14 Jul at 2%; and
    # Redeeming on 20 Jul adds a full month at 2%.
    assert july.unpaid_interest == 17_000 * RUPEE
    assert july.outstanding == 1_19_000 * RUPEE
    assert [(on, terms.monthly_rate_bps) for on, terms in projected.term_changes] == [
        (date(2026, 6, 14), 200)
    ]
    assert projected.paid_off_on is None


def test_a_projection_finds_when_hypothetical_payments_pay_it_off(
    conn: Connection,
) -> None:
    chain = add_mortgage(conn, add_customer(conn))

    projected = replay(conn, chain).projection(
        [TODAY],
        HypotheticalPayments(after=TODAY, amount=60_000 * RUPEE),
        paid_off_by=date(2027, 4, 20),
    )

    # 14 May: ₹60,000 of ₹1,12,000; 14 Jun: the remaining ₹52,000 + ₹1,560.
    assert projected.paid_off_on == date(2026, 6, 14)


def test_each_payment_is_found_applied_as_its_ledger_step(conn: Connection) -> None:
    ramesh = add_customer(conn)
    chain = add_mortgage(conn, ramesh)
    ring = add_mortgage(conn, ramesh, suffix="Ring")
    # ₹9,000 of interest is unpaid on 15 Apr, and ₹3,000 Interest to Date: the first
    # ₹2,000 and the next ₹10,000 are all interest.
    first = add_payment(conn, ramesh, date(2026, 4, 15), {chain: 2_000 * RUPEE})
    voided = add_payment(
        conn, ramesh, date(2026, 4, 16), {chain: 5_000 * RUPEE}, voided=True
    )
    second = add_payment(conn, ramesh, date(2026, 4, 18), {chain: 10_000 * RUPEE})
    elsewhere = add_payment(conn, ramesh, date(2026, 4, 18), {ring: 1_000 * RUPEE})

    applied = replay(conn, chain).steps_by_payment()

    assert set(applied) == {first, second}  # not the Voided one, nor the Ring's
    assert (
        applied[first].interest_paid,
        applied[first].principal_paid,
        applied[first].principal + applied[first].unpaid_interest,
    ) == (2_000 * RUPEE, 0, 1_07_000 * RUPEE)
    assert (
        applied[second].interest_paid,
        applied[second].principal_paid,
        applied[second].principal + applied[second].unpaid_interest,
    ) == (10_000 * RUPEE, 0, 1_00_000 * RUPEE)


def test_two_payments_on_one_day_are_applied_in_the_order_made(conn: Connection) -> None:
    ramesh = add_customer(conn)
    chain = add_mortgage(conn, ramesh)
    # ₹9,000 of interest is unpaid on 15 Apr, and ₹3,000 Interest to Date.
    first = add_payment(conn, ramesh, date(2026, 4, 15), {chain: 6_000 * RUPEE})
    second = add_payment(conn, ramesh, date(2026, 4, 15), {chain: 5_000 * RUPEE})

    applied = replay(conn, chain).steps_by_payment()

    assert (applied[first].interest_paid, applied[first].principal_paid) == (
        6_000 * RUPEE,
        0,
    )
    assert (applied[second].interest_paid, applied[second].principal_paid) == (
        5_000 * RUPEE,
        0,
    )


def test_a_redemptions_final_payment_is_applied_after_the_interest_to_date(
    conn: Connection,
) -> None:
    ramesh = add_customer(conn)
    chain = add_mortgage(conn, ramesh)
    # Redeemed on 20 Apr: ₹1,09,000 charged plus a full month's ₹3,000 Interest to Date.
    final = redeem(conn, chain, TODAY)
    assert final is not None

    step = replay(conn, chain).steps_by_payment()[final]

    assert step.amount == 1_12_000 * RUPEE
    assert step.interest_paid == 12_000 * RUPEE
    assert step.principal + step.unpaid_interest == 0


def test_payments_up_to_a_date_and_a_mortgage_never_paid(conn: Connection) -> None:
    ramesh = add_customer(conn)
    chain = add_mortgage(conn, ramesh)
    unpaid = add_mortgage(conn, ramesh, suffix="Ring")
    early = add_payment(conn, ramesh, date(2026, 3, 1), {chain: 1_000 * RUPEE})
    add_payment(conn, ramesh, date(2026, 4, 15), {chain: 1_000 * RUPEE})

    assert list(replay(conn, chain).steps_by_payment(date(2026, 4, 1))) == [early]
    assert replay(conn, unpaid).steps_by_payment() == {}


def test_a_outstanding_on_closure_leaves_out_interest_to_date_paid_ahead(conn: Connection) -> None:
    ramesh = add_customer(conn)
    chain = add_mortgage(conn, ramesh)
    # 15 Apr: ₹9,000 charged, then ₹1,000 of the month starting 14 Apr paid ahead.
    add_payment(conn, ramesh, date(2026, 4, 15), {chain: 10_000 * RUPEE})

    quote = replay(conn, chain).outstanding_on_closure(TODAY)

    assert (quote.principal, quote.unpaid_interest, quote.interest_to_date) == (
        LAKH,
        0,
        2_000 * RUPEE,
    )
    assert quote.total == 1_02_000 * RUPEE
