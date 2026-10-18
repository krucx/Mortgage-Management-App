"""Lists that come a page at a time, sorted by one of their keys.

A list declares its sort keys once (a `Sorting`), then asks for a page either of a SQL
query (`query_page`: counted, ordered and cut to the page in the database) or of rows
already worked out (`rows_page`). Either way the answer is a `Page`.
"""

from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass, field
from typing import Annotated, Any

from fastapi import Query
from pydantic import BaseModel
from sqlalchemy import ColumnElement, Select, UnaryExpression, func, select
from sqlalchemy.engine import Connection, RowMapping

PAGE_SIZE = 20

# The page asked for, counting from 1.
PageNumber = Annotated[int, Query(ge=1)]


class Page[T](BaseModel):
    items: list[T]
    total: int  # on every page
    page: int
    page_size: int


@dataclass(frozen=True)
class Sorting[K: str]:
    """A SQL list's sort keys: each key's column; the list's own order, on its own when
    no key is asked for and after the key otherwise; and unique columns that break any
    tie left in the direction of the sort, so that list sorted descending is the exact
    reverse of it sorted ascending."""

    columns: Mapping[K, ColumnElement[Any]]
    default_order: Sequence[UnaryExpression[Any]] = field(default=())
    ties: Sequence[ColumnElement[Any]] = field(default=())

    def order(self, sort: K | None, descending: bool) -> list[UnaryExpression[Any]]:
        first = [] if sort is None else [_ordered(self.columns[sort], descending)]
        return [
            *first,
            *self.default_order,
            *(_ordered(column, descending) for column in self.ties),
        ]


def query_page[K: str, T](
    conn: Connection,
    query: Select[Any],
    sorting: Sorting[K],
    page: int,
    to_items: Callable[[Sequence[RowMapping]], list[T]],
    sort: K | None = None,
    descending: bool = False,
) -> Page[T]:
    """Page `page` of `query`'s rows, sorted by `sort` (reversed when `descending`) and
    turned into items by `to_items`; the total counts every page."""
    total = conn.execute(
        select(func.count()).select_from(query.order_by(None).subquery())
    ).scalar_one()
    rows = (
        conn.execute(
            query.order_by(None)
            .order_by(*sorting.order(sort, descending))
            .limit(PAGE_SIZE)
            .offset((page - 1) * PAGE_SIZE)
        )
        .mappings()
        .all()
    )
    return Page(items=to_items(rows), total=total, page=page, page_size=PAGE_SIZE)


def rows_page[K: str, T](
    rows: Sequence[T],
    page: int | None,
    keys: Mapping[K, Callable[[T], Any]] | None = None,
    sort: K | None = None,
    descending: bool = False,
) -> Page[T]:
    """Page `page` of `rows` (every row on one page when `page` is None), sorted by
    the key `sort` names in `keys` (reversed when `descending`; equal keys keep the
    rows' own order), or as they come when no key is asked for."""
    if sort is not None:
        rows = sorted(rows, key=(keys or {})[sort], reverse=descending)
    if page is None:
        return Page(items=list(rows), total=len(rows), page=1, page_size=len(rows) or 1)
    return Page(
        items=page_of(rows, page), total=len(rows), page=page, page_size=PAGE_SIZE
    )


def page_of[T](items: Sequence[T], page: int) -> list[T]:
    """The items on page `page` (empty past the last)."""
    start = (page - 1) * PAGE_SIZE
    return list(items[start : start + PAGE_SIZE])


def _ordered(column: ColumnElement[Any], descending: bool) -> UnaryExpression[Any]:
    return column.desc() if descending else column.asc()
