#!/bin/sh
# Checks every request, message and count chapter 011 shows, against the real frontend.
#
# For the course's editors. Builds the sample book in a temporary folder (never the
# Lender's data), serves it on :8000 with serve.py (the clock held on 19 Oct 2026), runs
# the frontend's own dev server (`vite`, which passes /api to :8000) on :5199, and drives
# the screens in a headless browser with network.mjs, printing every /api/ request each
# step makes. Ports 8000 and 5199 must be free.
#
#     sh docs/onboarding/011-the-frontends-data-layer/scripts/run_throughs.sh
#
# Needs Playwright, as docs/sample-book uses it (cd docs/sample-book && npm install).
# Each section is headed with the lesson that quotes it (L1–L5, 99).
set -e
here=$(cd "$(dirname "$0")" && pwd)
repo=$(cd "$here/../../../.." && pwd)
work=$(mktemp -d)

(cd "$repo/backend" && uv run python ../docs/sample-book/book.py "$work" >/dev/null)
(cd "$repo/backend" && exec uv run python ../docs/sample-book/serve.py "$work" 8000) &
server=$!
(cd "$repo/frontend" && exec npx vite --port 5199 --strictPort --logLevel warn) &
vite=$!
trap 'kill $server $vite 2>/dev/null; rm -rf "$work"' EXIT
until curl -s -o /dev/null "http://127.0.0.1:8000/api/payment-methods"; do sleep 0.5; done
until curl -s -o /dev/null "http://localhost:5199/"; do sleep 0.5; done

echo "== L1: the schema the types come from"
(cd "$repo/backend" && uv run python - <<'EOF'
from mortgage_backend.openapi import schema
s = schema()
print("paths:", len(s["paths"]), " schemas:", len(s["components"]["schemas"]))
text = str(s)
print("received_with in schema:", "received_with" in text, " ready_to_redeem:", "ready_to_redeem" in text)
print("Mortgage fields:", sorted(s["components"]["schemas"]["Mortgage"]["properties"]))
EOF
)
grep -c "" "$repo/frontend/openapi.json" "$repo/frontend/src/api.gen.ts"

node "$here/network.mjs" "http://localhost:5199" "$repo"
