"""Photo files kept beside the database (see db.photos_dir), resized to keep backups small.

Every change that adds, replaces or removes a photo goes through photo_change, so a
photo's file is kept only if its change is saved: no orphan file is left behind in the
photos folder, or in a Backup.
"""

import re
import uuid
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from io import BytesIO
from pathlib import Path
from typing import Annotated, Literal, NamedTuple

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import FileResponse
from PIL import Image, ImageOps, UnidentifiedImageError
from sqlalchemy.engine import Connection, Engine

from mortgage_backend.platform.errors import unprocessable

MAX_EDGE_PX = 1600
_FILE_NAME = re.compile(r"^[a-z]+-\d+-[0-9a-f]{32}\.jpg$")


def get_photos_dir(request: Request) -> Path:
    """FastAPI dependency: the folder photos are stored in."""
    photos_dir: Path = request.app.state.photos_dir
    return photos_dir


PhotosDirDep = Annotated[Path, Depends(get_photos_dir)]


def photo_url(file_name: str | None) -> str | None:
    return f"/api/photos/{file_name}" if file_name else None


def _save_photo(
    photos_dir: Path, owner: Literal["mortgage", "customer"], owner_id: int, data: bytes
) -> str:
    """Store an uploaded image as a JPEG at most MAX_EDGE_PX on its long edge; returns the file name."""
    try:
        # Phone photos carry their rotation in EXIF; bake it in.
        image = ImageOps.exif_transpose(Image.open(BytesIO(data))).convert("RGB")
    except (UnidentifiedImageError, OSError):
        raise unprocessable("Not an image file")
    image.thumbnail((MAX_EDGE_PX, MAX_EDGE_PX))

    file_name = f"{owner}-{owner_id}-{uuid.uuid4().hex}.jpg"
    photos_dir.mkdir(parents=True, exist_ok=True)
    image.save(photos_dir / file_name, "JPEG", quality=85)
    return file_name


def _delete_photo(photos_dir: Path, file_name: str | None) -> None:
    if file_name:
        (photos_dir / file_name).unlink(missing_ok=True)


class NewPhoto(NamedTuple):
    """An uploaded image, and what it is a photo of."""

    owner: Literal["mortgage", "customer"]
    owner_id: int
    data: bytes


@dataclass
class PhotoChange:
    """A change being made in `conn`'s transaction, with its new photo's file (if any)
    already written; `remove_when_saved` names a file (one it replaced or removed) to
    delete once the change is saved."""

    conn: Connection
    new_file: str | None
    remove_when_saved: Callable[[str | None], None]

    @property
    def file(self) -> str:
        """The new photo's file name."""
        assert self.new_file is not None, "photo_change was given no NewPhoto"
        return self.new_file


@contextmanager
def photo_change(
    engine: Engine, photos_dir: Path, new: NewPhoto | None = None
) -> Iterator[PhotoChange]:
    """Make a change in one transaction: `new`'s file is written first, and removed if
    the change is refused or fails; once it is saved, the files it replaced are removed.
    Checking the owner and recording History stay with the change itself."""
    file_name = (
        _save_photo(photos_dir, new.owner, new.owner_id, new.data) if new else None
    )
    replaced: list[str | None] = []
    try:
        with engine.begin() as conn:
            yield PhotoChange(conn, file_name, replaced.append)
    except BaseException:
        _delete_photo(photos_dir, file_name)
        raise
    for old in replaced:
        _delete_photo(photos_dir, old)


router = APIRouter(prefix="/api")


@router.get("/photos/{file_name}")
def read_photo(file_name: str, photos_dir: PhotosDirDep) -> FileResponse:
    path = photos_dir / file_name
    if not _FILE_NAME.match(file_name) or not path.is_file():
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Photo not found")
    return FileResponse(path, media_type="image/jpeg")
