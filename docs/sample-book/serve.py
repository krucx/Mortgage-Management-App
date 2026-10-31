"""Serves the sample book (book.py) as it stood on 19 Oct 2026, with the app's built screens
(frontend/dist, `npm run build`), for shots.mjs to photograph:

    cd backend && uv run python ../docs/sample-book/serve.py <folder> [port]

The clock stays on the day of the story, so every figure is the one the story tells. Its
first request takes the week's Backup into <folder>/backups, for the Settings screenshot.
"""

import sys
from datetime import datetime, time
from pathlib import Path

import uvicorn
from book import THE_DAY

from mortgage_backend.main import create_app

if __name__ == "__main__":
    if len(sys.argv) not in (2, 3):
        sys.exit(__doc__)
    folder = Path(sys.argv[1]).resolve()
    port = int(sys.argv[2]) if len(sys.argv) == 3 else 8765
    app = create_app(
        f"sqlite:///{folder / 'data' / 'mortgage.db'}",
        today=lambda: THE_DAY,
        now=lambda: datetime.combine(THE_DAY, time(11, 0)),
        backup_dir=folder / "backups",
        screens_dir=Path(__file__).resolve().parents[2] / "frontend" / "dist",
    )
    uvicorn.run(app, host="127.0.0.1", port=port, log_level="warning")
