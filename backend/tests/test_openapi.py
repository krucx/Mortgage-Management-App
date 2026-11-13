from pathlib import Path

from mortgage_backend.openapi import schema_text

CHECKED_IN = Path(__file__).parents[2] / "frontend" / "openapi.json"


def test_ready_to_redeem_is_retired_from_the_api() -> None:
    # Paying the whole Outstanding Redeems (ADR 0011), so nothing waits to be Redeemed.
    schema = schema_text()
    assert [
        term
        for term in (
            "ready_to_redeem",
            "ready-to-redeem",
            "ReadyToRedeem",
            "received_with",
        )
        if term in schema
    ] == []


def test_the_frontends_copy_of_the_openapi_schema_is_up_to_date() -> None:
    assert CHECKED_IN.read_text() == schema_text(), (
        "The API changed: run `npm run gen:types` in frontend/ and commit the result"
    )
