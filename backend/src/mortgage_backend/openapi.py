"""The OpenAPI schema the frontend's types are generated from (see the README).

uv run python -m mortgage_backend.openapi ../frontend/openapi.json
"""

import json
import sys
from pathlib import Path
from typing import Any

from mortgage_backend.main import create_app


def schema() -> dict[str, Any]:
    # Building the schema never touches the database.
    return create_app("sqlite://").openapi()


def schema_text() -> str:
    return json.dumps(schema(), indent=2, sort_keys=True) + "\n"


if __name__ == "__main__":
    Path(sys.argv[1]).write_text(schema_text())
