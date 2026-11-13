"""Crafted uploads are refused with the usual 422, not a 500 or an exhausted server."""

import io
import zipfile

import pytest
from api_seed import lend, person
from openpyxl import Workbook
from PIL import Image

from mortgage_backend.platform.db import photos_dir

BILLION_LAUGHS = (
    b'<?xml version="1.0"?><!DOCTYPE bomb [<!ENTITY a "aaaaaaaaaa">'
    b'<!ENTITY b "&a;&a;&a;&a;&a;&a;&a;&a;&a;&a;">]>'
    b'<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
    b'<sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>&b;</t></is></c></row>'
    b"</sheetData></worksheet>"
)


def stored_photos(database_url: str) -> list[str]:
    folder = photos_dir(database_url)
    return sorted(p.name for p in folder.iterdir()) if folder.exists() else []


def png_of_pixels(width: int, height: int) -> bytes:
    out = io.BytesIO()
    Image.new("L", (width, height)).save(out, "PNG")
    return out.getvalue()


def xml_bomb_xlsx() -> bytes:
    """A real workbook whose sheet declares XML entities."""
    plain = io.BytesIO()
    Workbook().save(plain)
    out = io.BytesIO()
    with zipfile.ZipFile(plain) as source, zipfile.ZipFile(out, "w") as bomb:
        for item in source.namelist():
            body = source.read(item)
            bomb.writestr(
                item, BILLION_LAUGHS if item == "xl/worksheets/sheet1.xml" else body
            )
    return out.getvalue()


def test_a_decompression_bomb_image_is_refused_on_every_photo_route_and_nothing_is_stored(
    client, database_url, monkeypatch
):
    ramesh = person(client)
    chain = lend(client, ramesh)
    # Pillow refuses at twice this many pixels; a small limit stands in for a huge image.
    monkeypatch.setattr(Image, "MAX_IMAGE_PIXELS", 1000)
    bomb = png_of_pixels(100, 100)
    routes = [
        ("POST", f"/api/mortgages/{chain['id']}/photos"),
        ("PUT", f"/api/customers/{ramesh['id']}/photo"),
        ("PUT", f"/api/customers/{ramesh['id']}/id-photos/aadhaar"),
    ]

    for method, path in routes:
        response = client.request(
            method, path, files={"photo": ("photo.png", bomb, "image/png")}
        )

        assert response.status_code == 422, path
        assert response.json()["detail"] == "Not an image file"
    assert stored_photos(database_url) == []


@pytest.mark.parametrize("preview", [False, True])
def test_a_call_sheet_with_an_xml_bomb_is_refused(client, preview):
    response = client.post(
        "/api/call-list/import" + ("-preview" if preview else ""),
        files={"file": ("call-list.xlsx", xml_bomb_xlsx())},
    )

    assert response.status_code == 422
    assert "not an Excel" in response.json()["detail"]
