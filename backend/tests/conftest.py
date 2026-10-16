import pytest
from fastapi.testclient import TestClient

from mortgage_backend.app import create_app
from mortgage_backend.db import migrate


@pytest.fixture
def client(tmp_path):
    database_url = f"sqlite:///{tmp_path / 'mortgage.db'}"
    migrate(database_url)
    with TestClient(create_app(database_url)) as client:
        yield client
