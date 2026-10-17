"""The list module: a page of a SQL query or of rows already worked out, sorted by a
key the list declares once. Pages hold 20."""

from collections.abc import Sequence
from typing import Any

from seed import add_customer
from sqlalchemy import func, select, update
from sqlalchemy.engine import Connection, RowMapping

from mortgage_backend.db import customer_table
from mortgage_backend.paging import PAGE_SIZE, Page, Sorting, query_page, rows_page

# Customers by name, then newest first: the id breaks ties whichever way it is sorted.
SORTING = Sorting(
    columns={
        "name": func.lower(customer_table.c.name),
        "phone": customer_table.c.phone_1,
    },
    ties=[customer_table.c.id],
)


def add_people(conn: Connection, count: int) -> None:
    for n in range(1, count + 1):
        person = add_customer(conn, phone=f"98290{n:05d}")
        conn.execute(
            update(customer_table)
            .where(customer_table.c.id == person)
            # Two of each name, so ties are broken by the id
            .values(name=f"Person {(n + 1) // 2:02d}")
        )


def phones(rows: list[dict[str, Any]]) -> list[str]:
    return [row["phone_1"] for row in rows]


def as_dicts(rows: Sequence[RowMapping]) -> list[dict[str, Any]]:
    return [dict(row) for row in rows]


def a_page(conn: Connection, page: int, **sort: Any) -> Page[dict[str, Any]]:
    return query_page(
        conn, select(customer_table), SORTING, page=page, to_items=as_dicts, **sort
    )


def test_a_query_comes_a_page_at_a_time_with_the_total(conn: Connection) -> None:
    add_people(conn, 25)

    first, second = a_page(conn, 1, sort="phone"), a_page(conn, 2, sort="phone")

    assert (first.total, first.page, first.page_size) == (25, 1, PAGE_SIZE)
    assert phones(first.items + second.items) == [f"98290{n:05d}" for n in range(1, 26)]


def test_a_query_sorted_descending_is_the_exact_reverse(conn: Connection) -> None:
    add_people(conn, 25)

    up = a_page(conn, 1, sort="name").items + a_page(conn, 2, sort="name").items
    down = (
        a_page(conn, 1, sort="name", descending=True).items
        + a_page(conn, 2, sort="name", descending=True).items
    )

    assert phones(down) == list(reversed(phones(up)))
    assert phones(up)[:2] == ["9829000001", "9829000002"]  # a tie, broken by the id


def test_a_query_page_past_the_last_is_empty(conn: Connection) -> None:
    add_people(conn, 3)

    past = a_page(conn, 2)

    assert (past.items, past.total, past.page) == ([], 3, 2)


def test_a_query_without_a_sort_keeps_the_lists_own_order(conn: Connection) -> None:
    add_people(conn, 3)
    newest_first = Sorting(
        columns={"phone": customer_table.c.phone_1},
        default_order=[customer_table.c.id.desc()],
    )

    listed = query_page(
        conn, select(customer_table), newest_first, page=1, to_items=as_dicts
    )

    assert phones(listed.items) == ["9829000003", "9829000002", "9829000001"]


def test_rows_come_a_page_at_a_time_sorted_by_a_key() -> None:
    rows = [{"n": n, "owed": n % 7} for n in range(1, 26)]
    keys = {"owed": lambda row: row["owed"]}

    first = rows_page(rows, 1, keys, sort="owed", descending=True)
    second = rows_page(rows, 2, keys, sort="owed", descending=True)

    assert (first.total, len(first.items), len(second.items)) == (25, 20, 5)
    owed = [row["owed"] for row in first.items + second.items]
    assert owed == sorted(owed, reverse=True)
    # Equal keys keep the rows' own order
    assert [row["n"] for row in first.items[:4]] == [6, 13, 20, 5]


def test_rows_without_a_sort_keep_their_order_and_a_page_past_the_last_is_empty() -> (
    None
):
    rows = list(range(5))

    assert rows_page(rows, 1).items == rows
    assert (rows_page(rows, 2).items, rows_page(rows, 2).total) == ([], 5)


def test_every_row_on_one_page_when_no_page_is_asked_for() -> None:
    rows = list(range(25))

    every = rows_page(rows, None, {"n": lambda n: n}, sort="n", descending=True)

    assert (len(every.items), every.total, every.page, every.page_size) == (
        25,
        25,
        1,
        25,
    )
    assert every.items[0] == 24
