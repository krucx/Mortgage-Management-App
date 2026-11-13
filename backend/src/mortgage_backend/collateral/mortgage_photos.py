"""Photos of a Mortgage's jewellery, kept and removed with the file they are saved as."""

from datetime import datetime

from fastapi import APIRouter, HTTPException, UploadFile, status
from sqlalchemy import delete, insert, select
from sqlalchemy.engine import Connection

from mortgage_backend.lending.mortgages import Mortgage, load_mortgage
from mortgage_backend.lending.replay import mortgage_row
from mortgage_backend.platform import photos
from mortgage_backend.platform.clock import NowDep, TodayDep
from mortgage_backend.platform.db import EngineDep, mortgage_photo_table
from mortgage_backend.platform.photos import PhotosDirDep
from mortgage_backend.safekeeping import audit

router = APIRouter(prefix="/api")


def add_photo(conn: Connection, mortgage_id: int, file_name: str, now: datetime) -> int:
    """Keep a photo of the jewellery, already saved as `file_name`; its id."""
    mortgage_row(conn, mortgage_id)  # refused if there is no such Mortgage
    photo_id: int = conn.execute(
        insert(mortgage_photo_table)
        .values(mortgage_id=mortgage_id, file=file_name)
        .returning(mortgage_photo_table.c.id)
    ).scalar_one()
    audit.record(conn, now, "mortgage", mortgage_id, "photo_added")
    return photo_id


def remove_photo(
    conn: Connection, mortgage_id: int, photo_id: int, now: datetime
) -> str:
    """Stop keeping one of the Mortgage's photos; its file name, to delete once this
    is saved."""
    file_name: str | None = conn.execute(
        select(mortgage_photo_table.c.file).where(
            mortgage_photo_table.c.id == photo_id,
            mortgage_photo_table.c.mortgage_id == mortgage_id,
        )
    ).scalar()
    if file_name is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Photo not found")
    conn.execute(
        delete(mortgage_photo_table).where(mortgage_photo_table.c.id == photo_id)
    )
    audit.record(conn, now, "mortgage", mortgage_id, "photo_removed")
    return file_name


@router.post("/mortgages/{mortgage_id}/photos")
async def post_photo(
    mortgage_id: int,
    photo: UploadFile,
    engine: EngineDep,
    photos_dir: PhotosDirDep,
    today: TodayDep,
    now: NowDep,
) -> Mortgage:
    new = photos.NewPhoto("mortgage", mortgage_id, await photo.read())
    with photos.photo_change(engine, photos_dir, new) as change:
        add_photo(change.conn, mortgage_id, change.file, now)
        return load_mortgage(change.conn, mortgage_id, today)


@router.delete("/mortgages/{mortgage_id}/photos/{photo_id}")
def delete_photo(
    mortgage_id: int,
    photo_id: int,
    engine: EngineDep,
    photos_dir: PhotosDirDep,
    today: TodayDep,
    now: NowDep,
) -> Mortgage:
    with photos.photo_change(engine, photos_dir) as change:
        change.remove_when_saved(remove_photo(change.conn, mortgage_id, photo_id, now))
        return load_mortgage(change.conn, mortgage_id, today)
