"""Shared refusals stay in the domain and name the Mortgage they came from."""

from datetime import date

import pytest
from seed import add_customer, add_mortgage, forfeit
from sqlalchemy.engine import Connection

from mortgage_backend.lending.refusals import (
    refusal_names_mortgage,
    refuse_unless_active,
)
from mortgage_backend.lending.replay import mortgage_row
from mortgage_backend.platform.errors import Refusal


def test_a_missing_mortgage_is_a_domain_refusal(conn: Connection) -> None:
    with pytest.raises(Refusal) as error:
        mortgage_row(conn, 404)

    assert (error.value.kind, error.value.message) == (
        "not_found",
        "Mortgage not found",
    )


def test_a_closed_mortgage_is_a_conflict_refusal(conn: Connection) -> None:
    mortgage_id = add_mortgage(conn, add_customer(conn))
    forfeit(conn, mortgage_id, date(2026, 4, 14))
    row = mortgage_row(conn, mortgage_id)

    with pytest.raises(Refusal) as error:
        refuse_unless_active(row)

    assert error.value.kind == "conflict"
    assert "reopen it first" in error.value.message


def test_a_refusal_names_its_mortgage(
    conn: Connection,
) -> None:
    mortgage_id = add_mortgage(conn, add_customer(conn))
    name = mortgage_row(conn, mortgage_id)["name"]

    with pytest.raises(Refusal) as domain_error:
        with refusal_names_mortgage(conn, mortgage_id):
            raise Refusal("cannot do that", "unprocessable")

    assert domain_error.value.message == f"{name}: cannot do that"
