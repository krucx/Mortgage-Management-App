"""The lending query helpers: SQL only, no HTTP, so they are tested on a bare connection."""

from datetime import date

from seed import add_customer, add_mortgage, add_payment, redeem
from sqlalchemy import insert
from sqlalchemy.engine import Connection

from mortgage_backend.lending import queries
from mortgage_backend.lending.replay import MortgageStatus
from mortgage_backend.platform.db import mortgage_photo_table


def test_a_mortgage_comes_with_its_customers_name(conn: Connection):
    customer = add_customer(conn, name="Ramesh Kumar")
    mortgage = add_mortgage(conn, customer)

    row = queries.mortgage_with_customer(conn, mortgage)

    assert row is not None
    assert row["customer_name"] == "Ramesh Kumar"
    assert row["id"] == mortgage


def test_an_unknown_mortgage_is_none_not_an_http_error(conn: Connection):
    assert queries.mortgage_with_customer(conn, 999) is None


def test_photos_come_in_the_order_they_were_added(conn: Connection):
    mortgage = add_mortgage(conn, add_customer(conn))
    for file in ("b.jpg", "a.jpg"):
        conn.execute(
            insert(mortgage_photo_table).values(mortgage_id=mortgage, file=file)
        )

    assert [p.file for p in queries.photos_of(conn, mortgage)] == ["b.jpg", "a.jpg"]


def test_names_taken_are_the_name_and_its_numbered_variants_ignoring_case(
    conn: Connection,
):
    customer = add_customer(conn)
    add_mortgage(conn, customer, suffix="Chain")
    add_mortgage(conn, customer, suffix="Chain-2")
    add_mortgage(conn, customer, suffix="Ring")

    assert queries.names_like(conn, "2026-ramesh-chain") == {
        "2026-ramesh-chain",
        "2026-ramesh-chain-2",
    }


def test_a_customers_name_is_none_when_unknown(conn: Connection):
    customer = add_customer(conn, name="Ramesh Kumar")

    assert queries.customer_name_of(conn, customer) == "Ramesh Kumar"
    assert queries.customer_name_of(conn, 999) is None


def test_the_listing_filter_narrows_by_customer_status_and_closing(conn: Connection):
    ramesh = add_customer(conn)
    suresh = add_customer(conn, phone="9829000001", name="Suresh")
    kept = add_mortgage(conn, ramesh, suffix="Chain")
    redeemed = add_mortgage(conn, ramesh, suffix="Ring")
    other = add_mortgage(conn, suresh, suffix="Bangle")
    redeem(conn, redeemed, date(2026, 3, 1))

    def ids(**filters):
        match = queries.mortgage_filter(**filters)
        rows = conn.execute(queries.select_with_customer().where(match)).mappings()
        return {row["id"] for row in rows}

    assert ids() == {kept, redeemed, other}
    assert ids(customer_id=ramesh) == {kept, redeemed}
    assert ids(status=MortgageStatus.ACTIVE) == {kept, other}
    assert ids(closed=True) == {redeemed}
    assert ids(closed_in="2026-03") == {redeemed}
    assert ids(closed_in="2026-04") == set()
    assert ids(as_of=date(2026, 1, 1)) == set()
    assert ids(query="suresh") == {other}
    assert ids(query="ramesh-ring") == {redeemed}


def test_the_dashboard_totals_over_a_period(conn: Connection):
    customer = add_customer(conn)
    first = add_mortgage(conn, customer, suffix="Chain", start_date=date(2026, 1, 14))
    second = add_mortgage(conn, customer, suffix="Ring", start_date=date(2026, 2, 3))
    redeem(conn, second, date(2026, 3, 5))
    add_payment(conn, customer, date(2026, 2, 14), {first: 3_000_00})

    span = (date(2026, 2, 1), date(2026, 3, 31))
    assert queries.principal_lent_between(conn, *span) == second_amount(conn, second)
    assert queries.redemptions_between(conn, *span) == 1
    assert queries.redemptions_between(conn, date(2026, 4, 1), date(2026, 4, 30)) == 0


def second_amount(conn: Connection, mortgage: int) -> int:
    row = queries.mortgage_with_customer(conn, mortgage)
    assert row is not None
    return row["amount_lent"]
