"""The app's built screens (frontend/dist), served by the backend itself when it runs without
Docker (windows/run.ps1; in Docker nginx serves them): with the same caching as
frontend/nginx.conf, so the installed app picks up an update the same way."""

import os
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse

# Checked for a new version every time: the pages, the service worker, the manifest.
NO_CACHE = "no-cache"
# Built files carry a hash in their names, so they never change.
IMMUTABLE = "public, max-age=31536000, immutable"


def screens_dir_from_env() -> Path | None:
    """SCREENS_DIR, the built screens to serve, if set."""
    value = os.environ.get("SCREENS_DIR")
    return Path(value) if value else None


def serve_screens(app: FastAPI, screens_dir: Path) -> None:
    """Serve the screens in `screens_dir` at every path but /api: a file that is there as
    itself, any other path as the app (index.html), which finds its page from the path.
    Added after the API's routes, so it never answers for them."""
    root = screens_dir.resolve()

    @app.api_route("/{path:path}", methods=["GET", "HEAD"], include_in_schema=False)
    def screen(path: str) -> FileResponse:
        if path == "api" or path.startswith("api/"):
            raise HTTPException(status_code=404, detail="Not Found")
        file = (root / path).resolve()
        if path and file.is_file() and file.is_relative_to(root):
            kept = path.startswith("assets/")
            media_type = "application/manifest+json" if file.suffix == ".webmanifest" else None
            return FileResponse(
                file, media_type=media_type, headers={"Cache-Control": IMMUTABLE if kept else NO_CACHE}
            )
        if path.startswith("assets/"):
            raise HTTPException(status_code=404, detail="Not Found")
        return FileResponse(root / "index.html", headers={"Cache-Control": NO_CACHE})
