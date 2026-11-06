#!/bin/sh
# Checks what lesson 6 shows on the Calculator's screen, against the real frontend.
#
# For the course's editors. Builds the sample book in a temporary folder (never the
# Lender's data), serves it on :8000 with serve.py (the clock held on 19 Oct 2026), runs
# the frontend's dev server (`vite`, which passes /api to :8000) on :5199, and drives the
# Calculator in a headless browser with calculator.mjs. Nothing is saved. Ports 8000 and
# 5199 must be free.
#
#     sh Documentation/onboarding/005-replay-and-closures/scripts/calculator.sh
#
# Needs Playwright, as docs/sample-book uses it (cd docs/sample-book && npm install).
set -e
here=$(cd "$(dirname "$0")" && pwd)
repo=$(cd "$here/../../../.." && pwd)
work=$(mktemp -d)

(cd "$repo/backend" && uv run python ../docs/sample-book/book.py "$work" >/dev/null)
(cd "$repo/backend" && exec uv run python ../docs/sample-book/serve.py "$work" 8000) &
server=$!
(cd "$repo/frontend" && exec npx vite --port 5199 --strictPort --logLevel warn) &
vite=$!
trap 'kill $server $vite 2>/dev/null || true; rm -rf "$work"' EXIT
until curl -s -o /dev/null "http://127.0.0.1:8000/api/payment-methods"; do sleep 0.5; done
until curl -s -o /dev/null "http://localhost:5199/"; do sleep 0.5; done

node "$here/calculator.mjs" "http://localhost:5199" "$repo"
echo "== stored rows after (book.py made 10 Mortgages, 7 Customers, 33 Payments, 34 Allocations):"
for t in mortgage customer payment allocation; do
  echo "  $t: $(sqlite3 "$work/data/mortgage.db" "select count(*) from $t")"
done
