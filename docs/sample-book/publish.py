"""Publishes what shots.mjs took: each <name>.png as docs/shots/<name>.webp, with the
width and height of every <img> of it on the pages, and the markers' places (spots.json)
as story.html's SPOTS.

    cd backend && uv run python ../docs/sample-book/publish.py <shots folder>
"""

import json
import re
import sys
from pathlib import Path

from PIL import Image

DOCS = Path(__file__).resolve().parents[1]

if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    shots = Path(sys.argv[1])
    for png in sorted(shots.glob("*.png")):
        with Image.open(png) as image:
            image.convert("RGB").save(DOCS / "shots" / f"{png.stem}.webp", "WEBP", quality=82, method=6)
    spots = json.loads((shots / "spots.json").read_text())
    story = DOCS / "story.html"
    text = story.read_text()
    text, found = re.subn(r"^const SPOTS = .*$", lambda _: f"const SPOTS = {json.dumps(spots, separators=(',', ':'))}", text, flags=re.M)
    assert found == 1, "story.html has no SPOTS line"
    story.write_text(text)
    sizes = {}
    for png in shots.glob("*.png"):
        with Image.open(png) as image:
            sizes[png.stem] = image.size
    for page in DOCS.glob("*.html"):
        html = page.read_text()

        def sized(match: re.Match[str]) -> str:
            width, height = sizes[match.group(1)]
            return f'src="shots/{match.group(1)}.webp" width="{width}" height="{height}"'

        pattern = r'src="shots/([a-z0-9-]+)\.webp" width="\d+" height="\d+"'
        html = re.sub(pattern, lambda m: sized(m) if m.group(1) in sizes else m.group(0), html)
        page.write_text(html)
    print(f"{len(list(shots.glob('*.png')))} screenshots published; SPOTS updated")
