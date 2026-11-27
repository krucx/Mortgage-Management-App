"""A domain Refusal is translated to the frontend's existing error response."""

import pytest
from fastapi import APIRouter

from mortgage_backend.platform.errors import Refusal


@pytest.mark.parametrize(
    ("kind", "status", "message"),
    [
        ("unprocessable", 422, "cannot do that"),
        ("conflict", 409, "already closed"),
        ("not_found", 404, "Mortgage not found"),
    ],
)
def test_a_refusal_kind_keeps_the_existing_api_error_response(
    client, kind: str, status: int, message: str
) -> None:
    router = APIRouter()

    @router.get("/test-refusal")
    def refuse() -> None:
        raise Refusal(message, kind)

    client.app.include_router(router)

    response = client.get("/test-refusal")

    assert response.status_code == status
    assert response.content == f'{{"detail":"{message}"}}'.encode()
