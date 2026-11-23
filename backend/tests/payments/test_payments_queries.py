"""The payments query helpers: SQL only, no HTTP, so they are tested on a bare connection."""

from datetime import date

from seed import add_customer, add_mortgage, add_payment
from sqlalchemy.engine import Connection

from mortgage_backend.payments import queries


def _paid(conn: Connection, **kwargs):
    customer = add_customer(conn, name="Ramesh Kumar")
    mortgage = add_mortgage(conn, customer)
    payment = add_payment(
        conn, customer, date(2026, 2, 14), {mortgage: 3_000_00}, **kwargs
    )
    return customer, mortgage, payment


def test_a_payment_comes_with_its_customers_name_and_numbers(conn: Connection):
    _, _, payment = _paid(conn)

    row = queries.payment_with_customer(conn, payment)

    assert row is not None
    assert row["name"] == "Ramesh Kumar"
    assert row["phone_1"] == "9829012345"
    assert row["amount"] == 3_000_00


def test_an_unknown_payment_is_none_not_an_http_error(conn: Connection):
    assert queries.payment_with_customer(conn, 999) is None


def test_the_payments_received_in_a_period_leave_the_voided_out(conn: Connection):
    customer = add_customer(conn)
    mortgage = add_mortgage(conn, customer)
    add_payment(conn, customer, date(2026, 2, 14), {mortgage: 3_000_00})
    add_payment(conn, customer, date(2026, 2, 20), {mortgage: 1_000_00}, voided=True)
    add_payment(conn, customer, date(2026, 3, 14), {mortgage: 2_000_00})

    february = (date(2026, 2, 1), date(2026, 2, 28))
    assert queries.received_total(conn, *february) == 3_000_00
    assert queries.received_total(conn, date(2026, 5, 1), date(2026, 5, 31)) == 0
    assert sorted(
        queries.received_between(conn, date(2026, 2, 1), date(2026, 3, 31))
    ) == [
        (date(2026, 2, 14), 3_000_00),
        (date(2026, 3, 14), 2_000_00),
    ]


def test_a_receipts_parts_are_the_payment_and_those_received_with_it(conn: Connection):
    _, _, payment = _paid(conn)

    assert [p["id"] for p in queries.receipt_parts(conn, payment)] == [payment]


def test_no_advance_instalments_means_no_parts(conn: Connection):
    _, _, payment = _paid(conn)

    assert queries.advance_parts_of(conn, [payment]) == []
    assert queries.instalment_with_closed_on(conn, payment, 1) is None
