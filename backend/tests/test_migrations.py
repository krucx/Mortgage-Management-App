import pytest
from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from fastapi.testclient import TestClient

from mortgage_backend.main import create_app
from mortgage_backend.platform.db import make_engine, metadata, migrate


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


# SQLite can't reflect an expression-based index, so uq_mortgage_name goes unchecked.
@pytest.mark.filterwarnings("ignore:.*uq_mortgage_name")
def test_the_migrations_build_the_tables_the_app_declares(database_url):
    migrate(database_url)

    with make_engine(database_url).connect() as conn:
        drift = compare_metadata(MigrationContext.configure(conn), metadata)

    assert drift == []
