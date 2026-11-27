"""HTTP errors the Lender sees as messages in the app."""

from typing import Literal

from fastapi import HTTPException, status

RefusalKind = Literal["unprocessable", "conflict", "not_found"]


class Refusal(Exception):
    """A domain decision not to carry out a change, independent of HTTP."""

    def __init__(self, message: str, kind: RefusalKind):
        super().__init__(message)
        self.message = message
        self.kind = kind

    def __str__(self) -> str:
        return self.message


def unprocessable(message: str) -> HTTPException:
    """The request can't be carried out as asked (422), with a message for the Lender."""
    return HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, message)
