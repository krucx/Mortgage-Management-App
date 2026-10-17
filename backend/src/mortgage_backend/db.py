import os
from pathlib import Path
from typing import Annotated, Any

from alembic import command
from alembic.config import Config
from fastapi import Depends, Request
from sqlalchemy import (
    Column,
    DateTime,
    ForeignKey,
    Integer,
    MetaData,
    String,
    Table,
    create_engine,
    event,
    func,
    make_url,
)
from sqlalchemy.engine import Engine

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
