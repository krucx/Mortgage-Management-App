import pytest
from fastapi.testclient import TestClient

from mortgage_backend.main import create_app


@pytest.fixture
def database_url(tmp_path):
    return f"sqlite:///{tmp_path / 'mortgage.db'}"


@pytest.fixture
def client(database_url):
    with TestClient(create_app(database_url)) as client:
        yield client
