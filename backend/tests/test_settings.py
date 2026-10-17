"""The settings module: a group of values kept in the config table, declared once as a
model and its keys, read back with defaults and told to whoever reacts to a change."""

from datetime import date, datetime

from pydantic import BaseModel, Field
from sqlalchemy.engine import Connection

from mortgage_backend.db import get_config, set_config
from mortgage_backend.settings import ConfigGroup
from mortgage_backend.terms import InterestMode

TODAY = date(2026, 5, 12)


class Example(BaseModel):
    days: int = Field(default=2, ge=1)
    approve_first: bool = False
    mode: InterestMode = InterestMode.SIMPLE
    template: str = "Namaste {customer_name}"
    last_at: datetime | None = None
    updated_on: date | None = None


EXAMPLE = ConfigGroup.prefixed("example_", Example)


def test_what_is_set_is_read_back(conn: Connection) -> None:
    chosen = Example(
        days=5,
        approve_first=True,
        mode=InterestMode.COMPOUNDED_MONTHLY,
        template="Hi {customer_name},\nthanks",
        last_at=datetime(2026, 5, 12, 10, 30, 15, 250),
        updated_on=TODAY,
    )

    EXAMPLE.set(conn, chosen, TODAY)

    assert EXAMPLE.get(conn) == chosen


def test_what_was_never_set_reads_as_the_default(conn: Connection) -> None:
    set_config(conn, "example_days", "7")

    assert EXAMPLE.get(conn) == Example(days=7)


def test_values_are_stored_as_the_app_always_stored_them(conn: Connection) -> None:
    EXAMPLE.set(
        conn,
        Example(approve_first=True, mode=InterestMode.COMPOUNDED_YEARLY, updated_on=TODAY),
        TODAY,
    )

    assert get_config(conn, ["example_days", "example_approve_first", "example_mode"]) == {
        "example_days": "2",
        "example_approve_first": "true",
        "example_mode": "compounded_yearly",
    }
    assert get_config(conn, ["example_updated_on"]) == {"example_updated_on": "2026-05-12"}


def test_values_stored_before_load_as_they_were_meant(conn: Connection) -> None:
    for key, value in {
        "example_approve_first": "false",
        "example_days": "28",
        "example_last_at": "2026-05-12T10:30:00",
    }.items():
        set_config(conn, key, value)

    assert EXAMPLE.get(conn) == Example(
        days=28, approve_first=False, last_at=datetime(2026, 5, 12, 10, 30)
    )


def test_setting_nothing_forgets_the_value(conn: Connection) -> None:
    EXAMPLE.set(conn, Example(updated_on=TODAY), TODAY)

    EXAMPLE.set(conn, Example(updated_on=None), TODAY)

    assert EXAMPLE.get(conn).updated_on is None
    assert get_config(conn, ["example_updated_on"]) == {}


def test_keys_can_be_named_one_by_one(conn: Connection) -> None:
    class Rate(BaseModel):
        rate_per_gram: int | None = None

    rate = ConfigGroup(Rate, {"rate_per_gram": "gold_rate_22"})

    rate.set(conn, Rate(rate_per_gram=600_000), TODAY)

    assert get_config(conn, ["gold_rate_22"]) == {"gold_rate_22": "600000"}


def test_a_change_is_told_to_whoever_reacts_to_it(conn: Connection) -> None:
    told: list[tuple[int, date]] = []

    def react(conn: Connection, today: date) -> None:
        told.append((group.get(conn).days, today))

    group = ConfigGroup.prefixed("watched_", Example, after_set=[react])

    group.set(conn, Example(days=9), TODAY)

    assert told == [(9, TODAY)]
