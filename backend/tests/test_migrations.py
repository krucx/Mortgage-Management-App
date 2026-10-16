from fastapi.testclient import TestClient

from mortgage_backend.app import create_app
from mortgage_backend.db import migrate


def test_migrating_twice_keeps_the_lenders_settings(tmp_path):
    database_url = f"sqlite:///{tmp_path / 'mortgage.db'}"
    migrate(database_url)
    with TestClient(create_app(database_url)) as client:
        client.put(
            "/api/settings/default-terms",
            json={"monthly_rate_bps": 200, "interest_mode": "simple", "part_month_rule": "nothing"},
        )

    migrate(database_url)  # every backend start runs this

    with TestClient(create_app(database_url)) as client:
        assert client.get("/api/settings/default-terms").json()["monthly_rate_bps"] == 200
