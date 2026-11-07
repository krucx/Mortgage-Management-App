import pytest
from alembic import command
from alembic.autogenerate import compare_metadata
from alembic.config import Config
from alembic.migration import MigrationContext
from fastapi.testclient import TestClient
from sqlalchemy import text

from mortgage_backend.main import create_app
from mortgage_backend.platform.db import MIGRATIONS_DIR, make_engine, metadata, migrate


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


def test_renaming_notices_preserves_existing_reminders_and_settings(database_url):
    config = Config()
    config.set_main_option("script_location", str(MIGRATIONS_DIR))
    config.set_main_option("sqlalchemy.url", database_url)
    command.upgrade(config, "0016")
    with make_engine(database_url).begin() as conn:
        conn.execute(text("INSERT INTO customer (id, name, address, phone_1) VALUES (1, 'Ramesh', '', '9829012345')"))
        conn.execute(text(
            "INSERT INTO mortgage (id, customer_id, name, start_date, amount_lent, description, "
            "gross_weight_mg, net_weight_mg, purity_karat, monthly_rate_bps, interest_mode, part_month_rule) "
            "VALUES (1, 1, '2026-Ramesh-Chain', '2026-01-14', 10000000, 'Gold chain', "
            "10000, 9000, 22, 300, 'simple', 'full_month')"
        ))
        conn.execute(text(
            "INSERT INTO notice (id, customer_id, accrues_on, created_on, status, message, approved) "
            "VALUES (1, 1, '2026-05-14', '2026-05-12', 'awaiting_approval', NULL, 1)"
        ))
        conn.execute(text(
            "INSERT INTO notice_mortgage (notice_id, mortgage_id) VALUES (1, 1)"
        ))
        conn.execute(text(
            "INSERT INTO config (key, value) VALUES ('message_notice_days_before', '15')"
        ))

    migrate(database_url)

    with make_engine(database_url).connect() as conn:
        reminder = conn.execute(text(
            "SELECT id, customer_id, accrues_on, created_on, status, message, approved "
            "FROM reminder WHERE id = 1"
        )).one()
        mortgage_link = conn.execute(text(
            "SELECT reminder_id, mortgage_id FROM reminder_mortgage"
        )).one()
        setting = conn.execute(text(
            "SELECT value FROM config WHERE key = 'message_reminder_days_before'"
        )).scalar_one()

    assert tuple(reminder) == (1, 1, "2026-05-14", "2026-05-12", "awaiting_approval", None, 1)
    assert tuple(mortgage_link) == (1, 1)
    assert setting == "15"
