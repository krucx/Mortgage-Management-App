"""Other websites the Lender visits must not reach the app through their browser."""

import pytest
from conftest import TODAY
from fastapi.testclient import TestClient

from mortgage_backend.main import create_app

CSV = {"file": ("notes.csv", b"a,b\n", "text/csv")}


@pytest.fixture
def served(database_url, tmp_path):
    dist = tmp_path / "dist"
    dist.mkdir()
    (dist / "index.html").write_text("<html>the app</html>")
    with TestClient(
        create_app(database_url, today=lambda: TODAY, screens_dir=dist),
        base_url="http://localhost:8080",
    ) as client:
        yield client


@pytest.mark.parametrize("path", ["/api/customers", "/", "/mortgages/7"])
def test_a_rebound_host_gets_no_data_from_the_api_or_the_screens(served, path):
    response = served.get(path, headers={"Host": "evil.example:8080"})
    assert response.status_code == 400
    assert "the app" not in response.text


@pytest.mark.parametrize("host", ["localhost", "127.0.0.1:8000", "[::1]:8000", "LOCALHOST:8080"])
def test_the_app_answers_as_localhost_on_any_port(served, host):
    assert served.get("/api/customers", headers={"Host": host}).status_code == 200


def test_a_cross_site_multipart_post_is_refused(served):
    response = served.post(
        "/api/call-list/import", files=CSV, headers={"Origin": "https://evil.example"}
    )
    assert response.status_code == 403


def test_a_post_from_the_app_itself_goes_through(served):
    response = served.post(
        "/api/customers",
        json={"name": "A"},
        headers={"Origin": "http://localhost:8080"},
    )
    assert response.status_code != 403


def test_a_post_with_no_origin_goes_through(served):
    assert served.post("/api/customers", json={"name": "A"}).status_code != 403


def test_reading_from_another_site_is_left_to_the_browsers_same_origin_rule(served):
    response = served.get("/api/customers", headers={"Origin": "https://evil.example"})
    assert response.status_code == 200
