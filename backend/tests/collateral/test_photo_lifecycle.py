"""The photo lifecycle: a photo's file is kept only if the change it belongs to is
saved, and a photo it replaces or removes loses its file once it is."""

import io
from datetime import datetime

import pytest
from fastapi import HTTPException
from PIL import Image
from seed import add_customer, add_mortgage
from sqlalchemy.engine import Engine

from mortgage_backend.collateral import mortgage_photos
from mortgage_backend.lending import mortgages
from mortgage_backend.people import customer_changes
from mortgage_backend.platform import photos
from mortgage_backend.platform.db import make_engine, migrate

NOW = datetime(2026, 4, 20, 10, 0)


def jpeg() -> bytes:
    out = io.BytesIO()
    Image.new("RGB", (40, 25), "white").save(out, "JPEG")
    return out.getvalue()


@pytest.fixture
def engine(database_url: str) -> Engine:
    migrate(database_url)
    return make_engine(database_url)


@pytest.fixture
def photos_dir(tmp_path):
    return tmp_path / "photos"


def files(photos_dir) -> list[str]:
    return sorted(p.name for p in photos_dir.glob("*.jpg"))


def test_a_refused_change_leaves_no_new_file(engine, photos_dir):
    with pytest.raises(HTTPException):
        with photos.photo_change(
            engine, photos_dir, photos.NewPhoto("mortgage", 99, jpeg())
        ) as change:
            mortgage_photos.add_photo(
                change.conn, 99, change.file, NOW
            )  # no such Mortgage

    assert files(photos_dir) == []


def test_a_change_that_fails_after_writing_leaves_no_new_file(engine, photos_dir):
    with engine.begin() as conn:
        chain = add_mortgage(conn, add_customer(conn))

    with pytest.raises(RuntimeError):
        with photos.photo_change(
            engine, photos_dir, photos.NewPhoto("mortgage", chain, jpeg())
        ) as change:
            mortgage_photos.add_photo(change.conn, chain, change.file, NOW)
            raise RuntimeError("the database went away")

    assert files(photos_dir) == []
    with engine.connect() as conn:
        assert mortgages.load_mortgage(conn, chain, NOW.date()).photos == []


def test_a_saved_replacement_keeps_the_new_file_and_removes_the_old(engine, photos_dir):
    with engine.begin() as conn:
        ramesh = add_customer(conn)

    def replace() -> str:
        with photos.photo_change(
            engine, photos_dir, photos.NewPhoto("customer", ramesh, jpeg())
        ) as change:
            old = customer_changes.replace_photo(change.conn, ramesh, change.file, NOW)
            change.remove_when_saved(old)
            return change.file

    first = replace()
    second = replace()

    assert files(photos_dir) == [second]
    assert first != second


def test_a_saved_removal_removes_the_file(engine, photos_dir):
    with engine.begin() as conn:
        chain = add_mortgage(conn, add_customer(conn))
    with photos.photo_change(
        engine, photos_dir, photos.NewPhoto("mortgage", chain, jpeg())
    ) as change:
        photo_id = mortgage_photos.add_photo(change.conn, chain, change.file, NOW)

    with photos.photo_change(engine, photos_dir) as change:
        removed = mortgage_photos.remove_photo(change.conn, chain, photo_id, NOW)
        change.remove_when_saved(removed)

    assert files(photos_dir) == []


def test_a_photo_for_a_mortgage_that_isnt_there_leaves_no_file(client, tmp_path):
    response = client.post(
        "/api/mortgages/99/photos",
        files={"photo": ("photo.jpg", jpeg(), "image/jpeg")},
    )

    assert response.status_code == 404
    assert files(tmp_path / "photos") == []
