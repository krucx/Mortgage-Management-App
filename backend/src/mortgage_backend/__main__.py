"""Backend entrypoint: migrate the database, then serve the API.

    python -m mortgage_backend            # production
    python -m mortgage_backend --reload   # development
"""

import sys

import uvicorn

from mortgage_backend.db import data_dir, database_url_from_env, migrate


def main() -> None:
    data_dir().mkdir(parents=True, exist_ok=True)
    migrate(database_url_from_env())
    uvicorn.run(
        "mortgage_backend.app:create_app_from_env",
        factory=True,
        host="0.0.0.0",
        port=8000,
        reload="--reload" in sys.argv,
    )


if __name__ == "__main__":
    main()
