from collections.abc import Iterator
from datetime import date

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.engine import Connection

from mortgage_backend.main import create_app
from mortgage_backend.platform.db import make_engine, migrate

TODAY = date(2026, 4, 20)


@pytest.fixture
def database_url(tmp_path):
    return f"sqlite:///{tmp_path / 'mortgage.db'}"


@pytest.fixture
def client(database_url):
    with TestClient(create_app(database_url, today=lambda: TODAY)) as client:
        yield client


@pytest.fixture
def conn(database_url: str) -> Iterator[Connection]:
    """A connection to a fresh database (no app), in a transaction committed at the end."""
    migrate(database_url)
    with make_engine(database_url).begin() as conn:
        yield conn
