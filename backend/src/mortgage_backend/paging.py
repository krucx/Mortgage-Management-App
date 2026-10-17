"""Lists that come a page at a time."""

from collections.abc import Sequence
from typing import Annotated

from fastapi import Query

PAGE_SIZE = 20

# The page asked for, counting from 1.
PageNumber = Annotated[int, Query(ge=1)]


def page_of[T](items: Sequence[T], page: int) -> list[T]:
    """The items on page `page` (empty past the last)."""
    start = (page - 1) * PAGE_SIZE
    return list(items[start : start + PAGE_SIZE])
