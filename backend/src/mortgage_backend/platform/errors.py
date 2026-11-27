"""Refusals the Lender sees as messages in the app; `main` turns each into its HTTP
response, so domain code never speaks HTTP."""

from typing import Literal

RefusalKind = Literal["unprocessable", "conflict", "not_found"]


class Refusal(Exception):
    """A domain decision not to carry out a change, independent of HTTP."""

    def __init__(self, message: str, kind: RefusalKind):
        super().__init__(message)
        self.message = message
        self.kind = kind

    def __str__(self) -> str:
        return self.message
