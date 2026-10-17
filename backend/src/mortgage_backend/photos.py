"""Photo files kept beside the database (see db.photos_dir), resized to keep backups small."""

import re
import uuid
from io import BytesIO
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import FileResponse
from PIL import Image, ImageOps, UnidentifiedImageError

MAX_EDGE_PX = 1600
_FILE_NAME = re.compile(r"^[a-z]+-\d+-[0-9a-f]{32}\.jpg$")


def get_photos_dir(request: Request) -> Path:
    """FastAPI dependency: the folder photos are stored in."""
    photos_dir: Path = request.app.state.photos_dir
    return photos_dir


PhotosDirDep = Annotated[Path, Depends(get_photos_dir)]


def photo_url(file_name: str | None) -> str | None:
    return f"/api/photos/{file_name}" if file_name else None


def save_photo(photos_dir: Path, owner: str, owner_id: int, data: bytes) -> str:
    """Store an uploaded image as a JPEG at most MAX_EDGE_PX on its long edge; returns the file name."""
    try:
        # Phone photos carry their rotation in EXIF; bake it in.
        image = ImageOps.exif_transpose(Image.open(BytesIO(data))).convert("RGB")
    except (UnidentifiedImageError, OSError):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Not an image file")
    image.thumbnail((MAX_EDGE_PX, MAX_EDGE_PX))

    file_name = f"{owner}-{owner_id}-{uuid.uuid4().hex}.jpg"
    photos_dir.mkdir(parents=True, exist_ok=True)
    image.save(photos_dir / file_name, "JPEG", quality=85)
    return file_name


def delete_photo(photos_dir: Path, file_name: str | None) -> None:
    if file_name:
        (photos_dir / file_name).unlink(missing_ok=True)


router = APIRouter(prefix="/api")


@router.get("/photos/{file_name}")
def read_photo(file_name: str, photos_dir: PhotosDirDep) -> FileResponse:
    path = photos_dir / file_name
    if not _FILE_NAME.match(file_name) or not path.is_file():
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Photo not found")
    return FileResponse(path, media_type="image/jpeg")
