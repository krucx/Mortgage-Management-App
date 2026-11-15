"""The test seeds make their data through the change modules, so a seed the app would
refuse fails at setup instead of starting a test from an impossible state."""

from datetime import date

import pytest
from fastapi import HTTPException
from seed import RUPEE, add_customer, add_mortgage, add_payment
from sqlalchemy.engine import Connection


def test_a_seeded_overpayment_fails_at_setup(conn: Connection) -> None:
    ramesh = add_customer(conn)
    chain = add_mortgage(conn, ramesh)  # owes ₹1,09,000 on 15 Apr

    with pytest.raises(HTTPException) as refused:
        add_payment(conn, ramesh, date(2026, 4, 15), {chain: 2_00_000 * RUPEE})

    assert refused.value.status_code == 422


def test_a_seeded_customer_on_someone_elses_number_fails_at_setup(
    conn: Connection,
) -> None:
    add_customer(conn)

    with pytest.raises(HTTPException) as refused:
        add_customer(conn, name="Somebody Else")

    assert refused.value.status_code == 409
