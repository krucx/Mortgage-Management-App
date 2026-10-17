"""The audit log's record of what changed: one entry per changed field."""

from datetime import date

from mortgage_backend.audit import Change, changes


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
