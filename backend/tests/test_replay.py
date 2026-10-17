"""The Mortgage replay: a Mortgage's stored facts replayed into its Ledger, Outstanding
and Redemption Amount, straight against the database (no HTTP). Today is 20 Apr 2026
(see conftest).

The Mortgage throughout: ₹1,00,000 at 3% a month, Simple, Full-month rule, from
14 Jan 2026, so ₹3,000 of interest on each Accrual Date and ₹1,09,000 owed on 20 Apr.
"""

from datetime import date, datetime
from typing import Any

import pytest
from sqlalchemy import insert, update
from sqlalchemy.engine import Connection

from conftest import TODAY
from mortgage_backend.db import (
    allocation_table,
    customer_table,
    make_engine,
    migrate,
    mortgage_table,
    payment_table,
    term_change_table,
)
from mortgage_backend.ledger import HypotheticalPayments
from mortgage_backend.replay import replay, replays

RUPEE = 100  # paise
LAKH = 1_00_000 * RUPEE


@pytest.fixture
def conn(database_url: str) -> Any:
    migrate(database_url)
    with make_engine(database_url).begin() as conn:
        yield conn


def add_customer(conn: Connection, phone: str = "9829012345") -> int:
    customer_id: int = conn.execute(
        insert(customer_table)
        .values(name="Ramesh Kumar", address="", phone_1=phone)
        .returning(customer_table.c.id)
    ).scalar_one()
    return customer_id


def add_mortgage(conn: Connection, customer_id: int, **overrides: object) -> int:
    values = {
        "customer_id": customer_id,
        "name": f"2026-Ramesh-{overrides.pop('suffix', 'Chain')}",
        "start_date": date(2026, 1, 14),
        "amount_lent": LAKH,
        "description": "Gold chain",
        "gross_weight_mg": 20_000,
        "net_weight_mg": 19_000,
        "purity_karat": 22,
        "monthly_rate_bps": 300,
        "interest_mode": "simple",
        "part_month_rule": "full_month",
        **overrides,
    }
    mortgage_id: int = conn.execute(
        insert(mortgage_table).values(**values).returning(mortgage_table.c.id)
    ).scalar_one()
    return mortgage_id


def add_payment(
    conn: Connection,
    customer_id: int,
    paid_on: date,
    allocations: dict[int, int],
    voided: bool = False,
) -> int:
    payment_id: int = conn.execute(
        insert(payment_table)
        .values(
            customer_id=customer_id,
            paid_on=paid_on,
            amount=sum(allocations.values()),
            method="cash",
            voided_at=datetime(2026, 4, 20, 10) if voided else None,
            void_reason="mistake" if voided else None,
        )
        .returning(payment_table.c.id)
    ).scalar_one()
    conn.execute(
        insert(allocation_table),
        [
            {"payment_id": payment_id, "mortgage_id": mortgage_id, "amount": amount}
            for mortgage_id, amount in allocations.items()
        ],
    )
    return payment_id


def test_a_voided_payment_is_in_no_ledger(conn: Connection) -> None:
    ramesh = add_customer(conn)
    chain = add_mortgage(conn, ramesh)
    add_payment(conn, ramesh, date(2026, 4, 15), {chain: 2_000 * RUPEE})
    add_payment(conn, ramesh, date(2026, 4, 16), {chain: 5_000 * RUPEE}, voided=True)

    mortgage = replay(conn, chain)

    assert mortgage.outstanding(TODAY).total == 1_07_000 * RUPEE
    assert [s.amount for s in mortgage.ledger(TODAY) if s.event == "payment"] == [
        2_000 * RUPEE
    ]


def test_the_redemption_amount_adds_the_part_month_rule_charge(
    conn: Connection,
) -> None:
    chain = add_mortgage(conn, add_customer(conn))

    # 6 days after the 14 Apr Accrual Date: a full month's ₹3,000 more under Full-month.
    redemption = replay(conn, chain).redemption(TODAY)

    assert redemption.part_month_days == 6
    assert redemption.part_month_charge == 3_000 * RUPEE
    assert redemption.total == 1_12_000 * RUPEE


def close(conn: Connection, mortgage_id: int, **values: object) -> None:
    conn.execute(
        update(mortgage_table)
        .where(mortgage_table.c.id == mortgage_id)
        .values(**values)
    )


def test_a_redeemed_mortgage_owes_nothing_and_accrues_nothing_after(
    conn: Connection,
) -> None:
    ramesh = add_customer(conn)
    chain = add_mortgage(conn, ramesh)
    # Redeemed on the 14 Mar Accrual Date: two months' interest, no part-month charge.
    final = add_payment(conn, ramesh, date(2026, 3, 14), {chain: 1_06_000 * RUPEE})
    close(
        conn,
        chain,
        status="redeemed",
        closed_on=date(2026, 3, 14),
        redemption_payment_id=final,
    )

    mortgage = replay(conn, chain)

    assert mortgage.outstanding(TODAY).total == 0
    assert mortgage.ledger(TODAY)[-1].on == date(2026, 3, 14)


def test_a_redemption_amount_leaves_out_the_redemptions_own_final_payment(
    conn: Connection,
) -> None:
    ramesh = add_customer(conn)
    chain = add_mortgage(conn, ramesh)
    add_payment(conn, ramesh, date(2026, 2, 20), {chain: 1_000 * RUPEE})
    final = add_payment(conn, ramesh, date(2026, 3, 14), {chain: 1_05_000 * RUPEE})
    close(
        conn,
        chain,
        status="redeemed",
        closed_on=date(2026, 3, 14),
        redemption_payment_id=final,
    )

    # Owed on 14 Mar before the final Payment: ₹1,06,000 less the earlier ₹1,000.
    assert replay(conn, chain).redemption(date(2026, 3, 14)).total == 1_05_000 * RUPEE


def test_a_forfeited_mortgage_accrues_nothing_after_and_its_debt_is_settled(
    conn: Connection,
) -> None:
    chain = add_mortgage(conn, add_customer(conn))
    # Forfeited 6 days after the 14 Mar Accrual Date: ₹6,000 of interest plus a full
    # month's ₹3,000 under the Full-month rule, and nothing on 14 Apr.
    close(
        conn,
        chain,
        status="forfeited",
        closed_on=date(2026, 3, 20),
        recovered_amount=90_000 * RUPEE,
    )

    mortgage = replay(conn, chain)

    assert mortgage.outstanding(TODAY).total == 0
    ledger = mortgage.ledger(TODAY)
    assert all(step.on <= date(2026, 3, 20) for step in ledger)
    forfeited = ledger[-1]
    assert (forfeited.event, forfeited.amount) == ("forfeited", 1_09_000 * RUPEE)
    # What the Mortgage owed when it was Forfeited.
    assert mortgage.redemption(date(2026, 3, 20)).total == 1_09_000 * RUPEE


def test_term_changes_apply_from_their_accrual_date(conn: Connection) -> None:
    chain = add_mortgage(conn, add_customer(conn))
    conn.execute(
        insert(term_change_table).values(
            mortgage_id=chain, effective_on=date(2026, 3, 14), monthly_rate_bps=200
        )
    )

    mortgage = replay(conn, chain)

    # ₹3,000 on 14 Feb and 14 Mar, then ₹2,000 for the month starting 14 Mar.
    assert mortgage.outstanding(TODAY).total == 1_08_000 * RUPEE
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

    assert both[chain].outstanding(TODAY).total == 1_05_000 * RUPEE
    # ₹50,000 with ₹1,500 a month for three months, less ₹1,000.
    assert both[bangle].outstanding(TODAY).total == 53_500 * RUPEE


def test_a_projection_reports_each_chosen_date_in_one_replay(conn: Connection) -> None:
    chain = add_mortgage(conn, add_customer(conn))
    conn.execute(
        insert(term_change_table).values(
            mortgage_id=chain, effective_on=date(2026, 6, 14), monthly_rate_bps=200
        )
    )

    projected = replay(conn, chain).projection([TODAY, date(2026, 7, 20)])

    today, july = projected.snapshots
    # Today: ₹1,09,000 owed, plus a full month's ₹3,000 if Redeemed.
    assert (today.on, today.principal, today.unpaid_interest) == (
        TODAY,
        LAKH,
        9_000 * RUPEE,
    )
    assert today.redemption_amount == 1_12_000 * RUPEE
    # 14 May and 14 Jun at 3% (each charges the month before), 14 Jul at 2%; and
    # Redeeming on 20 Jul adds a full month at 2%.
    assert july.unpaid_interest == 17_000 * RUPEE
    assert july.redemption_amount == 1_19_000 * RUPEE
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
