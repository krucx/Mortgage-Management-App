"""Uploads over 20 MB are refused before they are read or stored, as nginx refused them
in Docker before the backend served the screens there too (ADR 0013)."""

import io

import pytest
from api_seed import lend, person
from PIL import Image

from mortgage_backend.platform.db import photos_dir

MB = 1024 * 1024
# Written out, not imported: the test pins the wording the Lender reads.
TOO_LARGE_MESSAGE = "The file is too large (over 20 MB)."


def photo_of(size: int) -> bytes:
    """A real JPEG, padded after its end to `size` bytes (image readers ignore the rest)."""
    out = io.BytesIO()
    Image.new("RGB", (40, 25), "white").save(out, "JPEG")
    return out.getvalue().ljust(size, b"\0")


def stored_photos(database_url: str) -> list[str]:
    """The files in the photos folder, which a refused upload must leave empty."""
    folder = photos_dir(database_url)
    return sorted(p.name for p in folder.iterdir()) if folder.exists() else []


@pytest.fixture
def ramesh(client):
    return person(client)


def test_a_photo_over_20_mb_is_refused_on_every_photo_route_and_nothing_is_stored(
    client, database_url, ramesh
):
    chain = lend(client, ramesh)
    routes = [
        ("POST", f"/api/mortgages/{chain['id']}/photos"),
        ("PUT", f"/api/customers/{ramesh['id']}/photo"),
        ("PUT", f"/api/customers/{ramesh['id']}/id-photos/aadhaar"),
    ]

    for method, path in routes:
        response = client.request(
            method, path, files={"photo": ("photo.jpg", photo_of(20 * MB + 1), "image/jpeg")}
        )

        assert response.status_code == 413, path
        assert response.json()["detail"] == TOO_LARGE_MESSAGE
    assert stored_photos(database_url) == []
    assert client.get(f"/api/mortgages/{chain['id']}").json()["photos"] == []
    customer = client.get(f"/api/customers/{ramesh['id']}").json()
    assert (customer["photo_url"], customer["aadhaar_photo_url"]) == (None, None)


def test_a_photo_just_under_20_mb_is_kept(client, database_url, ramesh):
    response = client.put(
        f"/api/customers/{ramesh['id']}/photo",
        files={"photo": ("photo.jpg", photo_of(20 * MB - 1024), "image/jpeg")},
    )

    assert response.status_code == 200, response.text
    assert response.json()["photo_url"].startswith("/api/photos/")
    assert len(stored_photos(database_url)) == 1


def test_a_body_sent_without_its_length_is_refused_once_it_passes_20_mb(client, ramesh):
    def chunks():  # no Content-Length: counted as it arrives
        yield (
            b'--x\r\nContent-Disposition: form-data; name="photo"; filename="photo.jpg"\r\n'
            b"Content-Type: image/jpeg\r\n\r\n"
        )
        for _ in range(21):
            yield b"\0" * MB

    response = client.put(
        f"/api/customers/{ramesh['id']}/photo",
        content=chunks(),
        headers={"Content-Type": "multipart/form-data; boundary=x"},
    )

    assert response.status_code == 413
    assert response.json()["detail"] == TOO_LARGE_MESSAGE
