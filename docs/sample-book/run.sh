#!/bin/sh
# Retakes every GitHub Pages screenshot from a freshly made sample book (see README.md):
# builds the app's screens, makes the book in a scratch folder, serves it, photographs it,
# and publishes the screenshots into docs/shots and their markers into story.html.
set -e
here=$(cd "$(dirname "$0")" && pwd)
repo=$(cd "$here/../.." && pwd)
work=$(mktemp -d)
port=${PORT:-8765}

(cd "$repo/frontend" && npm run build >/dev/null)
(cd "$repo/backend" && uv run python ../docs/sample-book/book.py "$work")
(cd "$repo/backend" && exec uv run python ../docs/sample-book/serve.py "$work" "$port") &
server=$!
trap 'kill $server 2>/dev/null; rm -rf "$work"' EXIT
until curl -s -o /dev/null "http://127.0.0.1:$port/api/backups"; do sleep 0.5; done

(cd "$here" && npm install --no-audit --no-fund --silent && node shots.mjs "$work/shots" "http://127.0.0.1:$port")
(cd "$repo/backend" && uv run python ../docs/sample-book/publish.py "$work/shots")
