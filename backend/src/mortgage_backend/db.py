import os
from collections.abc import Callable, Iterable
from pathlib import Path
from typing import Annotated, Any

from alembic import command
from alembic.config import Config
from alembic.runtime.migration import MigrationContext
from alembic.script import ScriptDirectory
from fastapi import Depends, Request
from sqlalchemy import (
    Column,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    MetaData,
    String,
    Table,
    UniqueConstraint,
    create_engine,
    event,
    func,
    make_url,
    select,
)
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.engine import Connection, Engine

MIGRATIONS_DIR = Path(__file__).parent / "migrations"

metadata = MetaData()

config_table = Table(
    "config",
    metadata,
    Column("key", String, primary_key=True),
    Column("value", String, nullable=False),
)

standalone_referrer_table = Table(
    "standalone_referrer",
    metadata,
    Column("id", Integer, primary_key=True),
    Column("name", String, nullable=False),
    Column("address", String, nullable=False),
    # Primary Number: identifies the person (see GLOSSARY.md).
    Column("phone", String, nullable=False, unique=True, index=True),
)

customer_table = Table(
    "customer",
    metadata,
    Column("id", Integer, primary_key=True),
    Column("name", String, nullable=False),
    Column("address", String, nullable=False),
    # Primary Number: identifies the person (see GLOSSARY.md).
    Column("phone_1", String, nullable=False, unique=True, index=True),
    Column("phone_2", String, index=True),
    Column("photo", String),  # file name under the photos folder
    # A Referrer is either another Customer or a standalone Referrer; at most one is set.
    Column("referred_by_customer_id", Integer, ForeignKey("customer.id")),
    Column(
        "referred_by_standalone_referrer_id",
        Integer,
        ForeignKey("standalone_referrer.id"),
    ),
    Column("created_at", DateTime, nullable=False, server_default=func.now()),
)


mortgage_table = Table(
    "mortgage",
    metadata,
    Column("id", Integer, primary_key=True),
    Column(
        "customer_id", Integer, ForeignKey("customer.id"), nullable=False, index=True
    ),
    Column("name", String, nullable=False),  # Mortgage Name, unique ignoring case
    Column("start_date", Date, nullable=False),
    Column("amount_lent", Integer, nullable=False),  # paise; the starting Principal
    Column("description", String, nullable=False),
    Column("gross_weight_mg", Integer, nullable=False),
    Column("net_weight_mg", Integer, nullable=False),
    Column("purity_karat", Integer, nullable=False),
    # Terms, copied from the Default Terms when the Mortgage is created.
    Column("monthly_rate_bps", Integer, nullable=False),
    Column("interest_mode", String, nullable=False),
    Column("part_month_rule", String, nullable=False),
    Column("status", String, nullable=False, server_default="active"),
    # Closing (Redeemed or Forfeited):
    Column("closed_on", Date),
    Column("redemption_payment_id", Integer, ForeignKey("payment.id")),
    Column("recovered_amount", Integer),  # paise; Forfeited only
    Column("closure_note", String),
    Column("collateral_override", Integer),  # paise; a Collateral Value set by hand
    Column("collateral_override_on", Date),
    Column("created_at", DateTime, nullable=False, server_default=func.now()),
)

Index("uq_mortgage_name", func.lower(mortgage_table.c.name), unique=True)

mortgage_photo_table = Table(
    "mortgage_photo",
    metadata,
    Column("id", Integer, primary_key=True),
    Column(
        "mortgage_id", Integer, ForeignKey("mortgage.id"), nullable=False, index=True
    ),
    Column("file", String, nullable=False),  # file name under the photos folder
)

payment_table = Table(
    "payment",
    metadata,
    Column("id", Integer, primary_key=True),
    Column(
        "customer_id", Integer, ForeignKey("customer.id"), nullable=False, index=True
    ),
    Column("paid_on", Date, nullable=False),
    Column("amount", Integer, nullable=False),  # paise
    Column("method", String, nullable=False),
    Column("reference", String),
    Column("created_at", DateTime, nullable=False, server_default=func.now()),
    Column("voided_at", DateTime),  # a Void keeps the Payment but out of every Ledger
    Column("void_reason", String),
)

# A change to a Mortgage's Terms from an Accrual Date on (see GLOSSARY.md: Term Change).
term_change_table = Table(
    "term_change",
    metadata,
    Column("id", Integer, primary_key=True),
    Column("mortgage_id", Integer, ForeignKey("mortgage.id"), nullable=False),
    Column("effective_on", Date, nullable=False),
    # Only what changes; None carries over from the Terms in force then.
    Column("monthly_rate_bps", Integer),
    Column("interest_mode", String),
    Column("part_month_rule", String),
    Column("created_at", DateTime, nullable=False, server_default=func.now()),
    UniqueConstraint("mortgage_id", "effective_on"),
)

# One change to a Customer, Mortgage or Payment (one row per changed field).
audit_entry_table = Table(
    "audit_entry",
    metadata,
    Column("id", Integer, primary_key=True),
    Column("at", DateTime, nullable=False),
    Column("entity", String, nullable=False),
    Column("entity_id", Integer, nullable=False),
    Column("action", String, nullable=False),
    Column("field", String),
    Column("old_value", String),
    Column("new_value", String),
    Column("note", String),  # e.g. the reason for a Void
    Index("ix_audit_entry_entity", "entity", "entity_id"),
)

# The Lender phoning a Customer about a Mortgage (see GLOSSARY.md: Call Note).
call_note_table = Table(
    "call_note",
    metadata,
    Column("id", Integer, primary_key=True),
    Column(
        "mortgage_id", Integer, ForeignKey("mortgage.id"), nullable=False, index=True
    ),
    Column("called_on", Date, nullable=False),
    Column("note", String, nullable=False),
    Column("created_at", DateTime, nullable=False, server_default=func.now()),
)

# The part of a Payment applied to one Mortgage.
allocation_table = Table(
    "allocation",
    metadata,
    Column("id", Integer, primary_key=True),
    Column("payment_id", Integer, ForeignKey("payment.id"), nullable=False, index=True),
    Column(
        "mortgage_id", Integer, ForeignKey("mortgage.id"), nullable=False, index=True
    ),
    Column("amount", Integer, nullable=False),  # paise
)


def get_config(conn: Connection, keys: Iterable[str]) -> dict[str, str]:
    """The settings stored under `keys`; missing ones are left out."""
    rows = conn.execute(
        select(config_table.c.key, config_table.c.value).where(
            config_table.c.key.in_(list(keys))
        )
    )
    return {key: value for key, value in rows}


def set_config(conn: Connection, key: str, value: str) -> None:
    """Insert or replace one setting in the config table."""
    conn.execute(
        sqlite_insert(config_table)
        .values(key=key, value=value)
        .on_conflict_do_update(index_elements=["key"], set_={"value": value})
    )


def exists(conn: Connection, table: Table, row_id: int) -> bool:
    return (
        conn.execute(select(table.c.id).where(table.c.id == row_id)).first() is not None
    )


def data_dir() -> Path:
    """Host folder (bind-mounted in Docker) holding the database and photos."""
    return Path(os.environ.get("DATA_DIR", "data"))


def database_url_from_env() -> str:
    return f"sqlite:///{data_dir() / 'mortgage.db'}"


def database_file(database_url: str) -> Path:
    return Path(make_url(database_url).database or "")


def photos_dir(database_url: str) -> Path:
    """Photos live beside the database, so one folder holds all of the Lender's data."""
    return database_file(database_url).parent / "photos"


def make_engine(database_url: str) -> Engine:
    engine = create_engine(database_url)

    @event.listens_for(engine, "connect")
    def enforce_foreign_keys(dbapi_connection: Any, _record: Any) -> None:
        dbapi_connection.execute("PRAGMA foreign_keys = ON")

    return engine


def get_engine(request: Request) -> Engine:
    """FastAPI dependency: the app's database engine."""
    engine: Engine = request.app.state.engine
    return engine


EngineDep = Annotated[Engine, Depends(get_engine)]


def migrate(
    database_url: str, before_update: Callable[[], object] | None = None
) -> None:
    """Create the database if needed and bring its schema up to date.

    `before_update` runs first when an existing database is about to be migrated
    (never on a fresh install); if it raises, nothing is migrated.
    """
    database_file(database_url).parent.mkdir(parents=True, exist_ok=True)
    alembic_config = Config()
    alembic_config.set_main_option("script_location", str(MIGRATIONS_DIR))
    alembic_config.set_main_option("sqlalchemy.url", database_url)
    if before_update is not None:
        head = ScriptDirectory.from_config(alembic_config).get_current_head()
        engine = create_engine(database_url)
        try:
            with engine.connect() as conn:
                current = MigrationContext.configure(conn).get_current_revision()
        finally:
            engine.dispose()
        if current is not None and current != head:
            before_update()
    command.upgrade(alembic_config, "head")
