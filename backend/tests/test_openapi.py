from pathlib import Path

from mortgage_backend.openapi import schema_text

CHECKED_IN = Path(__file__).parents[2] / "frontend" / "openapi.json"


def test_the_frontends_copy_of_the_openapi_schema_is_up_to_date() -> None:
    assert CHECKED_IN.read_text() == schema_text(), (
        "The API changed: run `npm run gen:types` in frontend/ and commit the result"
    )
