from fastapi.testclient import TestClient

from mortgage_backend.main import create_app


def test_restarting_the_app_keeps_the_lenders_settings(database_url):
    with TestClient(create_app(database_url)) as client:
        client.put(
            "/api/settings/default-terms",
            json={
                "monthly_rate_bps": 200,
                "interest_mode": "simple",
                "part_month_rule": "nothing",
            },
        )

    with TestClient(
        create_app(database_url)
    ) as client:  # migrations run again on start
        assert (
            client.get("/api/settings/default-terms").json()["monthly_rate_bps"] == 200
        )
