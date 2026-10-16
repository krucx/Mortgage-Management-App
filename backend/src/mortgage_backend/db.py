import os
from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy import Column, MetaData, String, Table, make_url

MIGRATIONS_DIR = Path(__file__).parent / "migrations"

metadata = MetaData()

config_table = Table(
    "config",
    metadata,
    Column("key", String, primary_key=True),
    Column("value", String, nullable=False),
)


def data_dir() -> Path:
    """Host folder (bind-mounted in Docker) holding the database and photos."""
    return Path(os.environ.get("DATA_DIR", "data"))


def database_url_from_env() -> str:
    return f"sqlite:///{data_dir() / 'mortgage.db'}"


def migrate(database_url: str) -> None:
    """Create the database if needed and bring its schema up to date."""
    database_file = make_url(database_url).database
    if database_file:
        Path(database_file).parent.mkdir(parents=True, exist_ok=True)
    alembic_config = Config()
    alembic_config.set_main_option("script_location", str(MIGRATIONS_DIR))
    alembic_config.set_main_option("sqlalchemy.url", database_url)
    command.upgrade(alembic_config, "head")
