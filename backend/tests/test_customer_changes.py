"""Changes to Customers, straight against the database: saving one (new or edited),
replacing its photo and deleting it, each refused, written and recorded in History in
one place. A Primary Number identifies a person (ADR 0005)."""

from datetime import datetime

import pytest
from fastapi import HTTPException
from seed import add_mortgage
from sqlalchemy import select
from sqlalchemy.engine import Connection

from mortgage_backend.people import customer_changes
from mortgage_backend.people.customers import (
    CustomerIn,
    ExistingCustomerReferrer,
    ExistingStandaloneReferrer,
    NewStandaloneReferrer,
    load_customer,
)
from mortgage_backend.platform.db import standalone_referrer_table
from mortgage_backend.safekeeping.audit import customer_history

NOW = datetime(2026, 4, 20, 11, 0)
MOHAN = NewStandaloneReferrer(
    kind="new", name="Mohan Lal", address="Johari Bazaar", phone="9414099999"
)


def customer(name: str = "Ramesh Kumar", phone: str = "9829012345", **fields: object):
    return CustomerIn.model_validate(
        {"name": name, "address": "Jaipur", "phone_1": phone, **fields}
    )


def save(conn: Connection, details: CustomerIn, customer_id: int | None = None) -> int:
    """Create the Customer, or edit the one with `customer_id`."""
    if customer_id is None:
        return customer_changes.create_customer(conn, details, NOW)
    customer_changes.edit_customer(conn, customer_id, details, NOW)
    return customer_id


def refused_save(
    conn: Connection, details: CustomerIn, customer_id: int | None = None
) -> tuple[int, str]:
    """How saving `details` is refused: the status code and why."""
    with pytest.raises(HTTPException) as refused:
        save(conn, details, customer_id)
    return refused.value.status_code, str(refused.value.detail)


def referrer_ids(conn: Connection) -> list[int]:
    return list(conn.execute(select(standalone_referrer_table.c.id)).scalars())


def test_a_new_customer_is_saved_and_recorded(conn: Connection) -> None:
    ramesh = save(conn, customer())

    assert load_customer(conn, ramesh).name == "Ramesh Kumar"
    created = {e.field: e.new_value for e in customer_history(conn, ramesh)}
    assert (created["name"], created["phone_1"]) == ("Ramesh Kumar", "9829012345")


def test_someone_elses_primary_number_is_refused_new_or_edited(
    conn: Connection,
) -> None:
    save(conn, customer())
    suresh = save(conn, customer("Suresh Jain", "9000000002"))

    expected = (
        409,
        "Contact number 1 9829012345 already belongs to Customer Ramesh Kumar",
    )
    assert refused_save(conn, customer("Somebody Else")) == expected
    assert refused_save(conn, customer("Suresh Jain"), suresh) == expected


def test_a_standalone_referrer_who_borrows_is_promoted_with_their_referrals(
    conn: Connection,
) -> None:
    ramesh = save(conn, customer(referrer=MOHAN))  # Mohan: a Standalone Referrer
    assert len(referrer_ids(conn)) == 1

    mohan = save(conn, customer("Mohan Lal", MOHAN.phone))

    assert referrer_ids(conn) == []
    referrer = load_customer(conn, ramesh).referrer
    assert referrer is not None
    assert (referrer.kind, referrer.id) == ("customer", mohan)


def test_a_new_referrer_whose_number_is_known_is_that_person(conn: Connection) -> None:
    ramesh = save(conn, customer())

    sita = save(
        conn,
        customer(
            "Sita Devi",
            "9000000003",
            referrer=NewStandaloneReferrer(
                kind="new", name="R. Kumar", address="", phone="9829012345"
            ),
        ),
    )

    referrer = load_customer(conn, sita).referrer
    assert referrer is not None and (referrer.kind, referrer.id) == ("customer", ramesh)
    assert referrer_ids(conn) == []


def test_a_customer_cannot_be_their_own_referrer(conn: Connection) -> None:
    ramesh = save(conn, customer())
    save(conn, customer("Sita Devi", "9000000003", referrer=MOHAN))
    [mohan_referrer] = referrer_ids(conn)
    own = (422, "A Customer cannot be their own Referrer")

    # Editing themselves as their Referrer
    themselves = ExistingCustomerReferrer(kind="customer", id=ramesh)
    assert refused_save(conn, customer(referrer=themselves), ramesh) == own
    # A new Referrer with their own number
    assert refused_save(
        conn,
        customer(
            "Asha Rao",
            "9000000004",
            referrer=NewStandaloneReferrer(
                kind="new", name="Asha", address="", phone="9000000004"
            ),
        ),
    ) == own
    # The Standalone Referrer they are being promoted from
    assert refused_save(
        conn,
        customer(
            "Mohan Lal",
            MOHAN.phone,
            referrer=ExistingStandaloneReferrer(kind="referrer", id=mohan_referrer),
        ),
    ) == own


def test_an_edit_is_recorded_field_by_field(conn: Connection) -> None:
    ramesh = save(conn, customer())

    save(conn, customer(address="Ajmer"), ramesh)

    [edited] = [e for e in customer_history(conn, ramesh) if e.action == "edited"]
    assert (edited.field, edited.old_value, edited.new_value) == (
        "address",
        "Jaipur",
        "Ajmer",
    )


def test_a_customer_with_mortgages_cannot_be_deleted(conn: Connection) -> None:
    ramesh = save(conn, customer())
    add_mortgage(conn, ramesh)

    with pytest.raises(HTTPException) as refused:
        customer_changes.remove_customer(conn, ramesh, NOW)

    assert (refused.value.status_code, refused.value.detail) == (
        409,
        "A Customer with Mortgages cannot be deleted",
    )


def test_deleting_a_customer_unlinks_those_they_referred_and_is_recorded(
    conn: Connection,
) -> None:
    ramesh = save(conn, customer())
    sita = save(
        conn,
        customer(
            "Sita Devi",
            "9000000003",
            referrer=ExistingCustomerReferrer(kind="customer", id=ramesh),
        ),
    )

    photo = customer_changes.remove_customer(conn, ramesh, NOW)

    assert photo is None
    assert load_customer(conn, sita).referrer is None
    assert [(e.action, e.note) for e in customer_history(conn, ramesh)][0] == (
        "deleted",
        "Ramesh Kumar",
    )


def test_a_replaced_photo_gives_back_the_old_file_and_is_recorded(
    conn: Connection,
) -> None:
    ramesh = save(conn, customer())

    first = customer_changes.replace_photo(conn, ramesh, "customer-1-a.jpg", NOW)
    second = customer_changes.replace_photo(conn, ramesh, "customer-1-b.jpg", NOW)

    assert (first, second) == (None, "customer-1-a.jpg")
    assert [e.action for e in customer_history(conn, ramesh)][:2] == [
        "photo_added",
        "photo_added",
    ]


def test_a_new_referrer_with_the_number_a_customer_had_before_an_edit_is_them(
    conn: Connection,
) -> None:
    ramesh = save(conn, customer())
    moved = customer(
        phone="9000000005",
        referrer=NewStandaloneReferrer(
            kind="new", name="R. Kumar", address="", phone="9829012345"
        ),
    )

    assert refused_save(conn, moved, ramesh) == (
        422,
        "A Customer cannot be their own Referrer",
    )
