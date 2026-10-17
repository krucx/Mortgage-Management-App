"""HTTP errors the Lender sees as messages in the app."""

from fastapi import HTTPException, status


def unprocessable(message: str) -> HTTPException:
    """The request can't be carried out as asked (422), with a message for the Lender."""
    return HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, message)
