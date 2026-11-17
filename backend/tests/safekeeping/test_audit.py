"""The audit log's record of what changed: one entry per changed field."""

from datetime import date, datetime

from seed import add_customer

from mortgage_backend.platform.paging import PAGE_SIZE
from mortgage_backend.safekeeping.audit import Change, changes, customer_history, record


def test_only_changed_fields_are_recorded_as_text():
    before = {
        "name": "Gold chain",
        "amount_lent": 100_000_00,
        "start_date": date(2026, 1, 14),
    }
    after = {
        "name": "Gold chain",
        "amount_lent": 90_000_00,
        "start_date": date(2026, 1, 15),
    }

    assert changes(before, after, ["name", "amount_lent", "start_date"]) == [
        Change("amount_lent", "10000000", "9000000"),
        Change("start_date", "2026-01-14", "2026-01-15"),
    ]


def test_a_field_cleared_or_set_keeps_the_missing_side_empty():
    assert changes({"phone_2": None}, {"phone_2": "9829012345"}, ["phone_2"]) == [
        Change("phone_2", None, "9829012345")
    ]
    assert changes({"phone_2": "9829012345"}, {"phone_2": None}, ["phone_2"]) == [
        Change("phone_2", "9829012345", None)
    ]


def test_nothing_changed_records_nothing():
    assert changes({"name": "A"}, {"name": "A"}, ["name"]) == []


def test_history_comes_a_page_of_whole_changes_at_a_time_newest_first(conn):
    ramesh = add_customer(conn)  # one change: created, a row per field
    for n in range(1, 25):  # 24 edits of two fields each
        record(
            conn,
            datetime(2026, 2, 1, 10, n),
            "customer",
            ramesh,
            "edited",
            [Change("address", None, f"House {n}"), Change("email", None, f"{n}@k.in")],
        )

    first, second = customer_history(conn, ramesh, 1), customer_history(conn, ramesh, 2)

    assert (first.total, len(first.items), len(second.items)) == (25, PAGE_SIZE, 5)
    edits = first.items + second.items[:-1]
    assert [[e.new_value for e in edit] for edit in edits][:2] == [
        ["24@k.in", "House 24"],
        ["23@k.in", "House 23"],
    ]
    assert all(len(edit) == 2 for edit in edits)
    [created] = second.items[-1:]
    assert {e.action for e in created} == {"created"}
    assert {"name", "phone_1"} <= {e.field for e in created}
