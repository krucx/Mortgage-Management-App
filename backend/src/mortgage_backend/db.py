import os
from pathlib import Path
from typing import Annotated, Any

from alembic import command
from alembic.config import Config
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
    create_engine,
    event,
    func,
    make_url,
    select,
)
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


def migrate(database_url: str) -> None:
    """Create the database if needed and bring its schema up to date."""
    database_file(database_url).parent.mkdir(parents=True, exist_ok=True)
    alembic_config = Config()
    alembic_config.set_main_option("script_location", str(MIGRATIONS_DIR))
    alembic_config.set_main_option("sqlalchemy.url", database_url)
    command.upgrade(alembic_config, "head")
