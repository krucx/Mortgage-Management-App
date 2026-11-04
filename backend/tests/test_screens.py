"""Without Docker, the backend also serves the app's built screens (frontend/dist), as nginx
does in Docker: the app at any of its paths, with the same caching."""

import re
from pathlib import Path

import pytest
from conftest import TODAY
from fastapi.testclient import TestClient

from mortgage_backend.main import create_app


@pytest.fixture
def screens(tmp_path):
    built = tmp_path / "dist"
    (built / "assets").mkdir(parents=True)
    (built / "index.html").write_text("<html>the app</html>")
    (built / "assets" / "index-3f9a1c.js").write_text("console.log('screens')")
    (built / "sw.js").write_text("// the service worker")
    (built / "manifest.webmanifest").write_text('{"name": "Mortgage Management"}')
    return built


@pytest.fixture
def served(database_url, screens):
    with TestClient(create_app(database_url, today=lambda: TODAY, screens_dir=screens)) as client:
        yield client


@pytest.mark.parametrize("path", ["/", "/mortgages/7", "/payments/new"])
def test_the_app_opens_at_any_of_its_paths_checked_for_a_new_version_each_time(served, path):
    response = served.get(path)

    assert response.status_code == 200
    assert response.text == "<html>the app</html>"
    assert response.headers["cache-control"] == "no-cache"


def test_built_files_are_kept_as_they_never_change(served):
    response = served.get("/assets/index-3f9a1c.js")

    assert response.text == "console.log('screens')"
    assert response.headers["cache-control"] == "public, max-age=31536000, immutable"


@pytest.mark.parametrize("path", ["/sw.js", "/manifest.webmanifest"])
def test_the_service_worker_and_manifest_are_always_checked(served, path):
    response = served.get(path)

    assert response.status_code == 200
    assert response.headers["cache-control"] == "no-cache"


def test_the_manifest_has_its_own_type(served):
    assert served.get("/manifest.webmanifest").headers["content-type"].startswith(
        "application/manifest+json"
    )


def test_the_api_is_never_answered_with_the_app(served):
    assert served.get("/api/customers").status_code == 200
    missing = served.get("/api/no-such-thing")
    assert missing.status_code == 404
    assert missing.json() == {"detail": "Not Found"}


def test_without_built_screens_only_the_api_is_served(client):
    assert client.get("/").status_code == 404


def test_a_page_can_be_asked_for_its_headers_alone(served):
    response = served.head("/mortgages/7")

    assert response.status_code == 200
    assert response.headers["cache-control"] == "no-cache"


NGINX_CONF = Path(__file__).parents[2] / "frontend" / "nginx.conf"

# A path in each of nginx.conf's locations that sets a Cache-Control.
A_PATH_IN_EACH_LOCATION = {
    "/": "/mortgages/7",
    r"~ ^/(sw\.js|registerSW\.js|workbox-[^/]+\.js)$": "/sw.js",
    "= /manifest.webmanifest": "/manifest.webmanifest",
    "/assets/": "/assets/index-3f9a1c.js",
}


def nginx_cache_control() -> dict[str, str]:
    """Each nginx.conf location that sets a Cache-Control, with what it sets."""
    headers = {}
    for block in re.split(r"^\s*location\s+", NGINX_CONF.read_text(), flags=re.M)[1:]:
        location, body = block.split("{", 1)
        header = re.search(r'add_header Cache-Control "([^"]*)"', body)
        if header:
            headers[location.strip()] = header.group(1)
    return headers


def test_the_screens_are_cached_as_nginx_caches_them_in_docker(served):
    backend_cache_control = {
        location: served.get(path).headers["cache-control"]
        for location, path in A_PATH_IN_EACH_LOCATION.items()
    }

    assert backend_cache_control == nginx_cache_control()
