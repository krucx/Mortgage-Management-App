#!/bin/sh
# Checks every screen, message and figure chapter 012 shows, against the real frontend.
#
# For the course's editors. Lessons 1–5: builds the sample book in a temporary folder
# (never the Lender's data), serves it on :8000 with serve.py (the clock held on 19 Oct
# 2026), runs the frontend's own dev server (`vite`, which passes /api to :8000) on :5199,
# and drives the screens in a headless browser with screens.mjs. Lesson 6: builds the
# screens (`npm run build`), serves a second fresh book with them on serve.py's own port,
# 8765, and drives the installed app's service worker with pwa.mjs. Ports 8000, 5199 and
# 8765 must be free.
#
#     sh docs/onboarding/012-frontend-pages-and-the-pwa/scripts/run_throughs.sh
#
# Needs Playwright, as docs/sample-book uses it (cd docs/sample-book && npm install).
# Each section is headed with the lesson that quotes it (L1–L6).
set -e
here=$(cd "$(dirname "$0")" && pwd)
repo=$(cd "$here/../../../.." && pwd)
work=$(mktemp -d)
pwa=$(mktemp -d)

(cd "$repo/backend" && uv run python ../docs/sample-book/book.py "$work" >/dev/null)
(cd "$repo/backend" && exec uv run python ../docs/sample-book/serve.py "$work" 8000) &
server=$!
(cd "$repo/frontend" && node scripts/copy-ocr.mjs >/dev/null && exec npx vite --port 5199 --strictPort --logLevel warn) &
vite=$!
trap 'kill $server $vite 2>/dev/null || true; rm -rf "$work" "$pwa"' EXIT
until curl -s -o /dev/null "http://127.0.0.1:8000/api/payment-methods"; do sleep 0.5; done
until curl -s -o /dev/null "http://localhost:5199/"; do sleep 0.5; done

echo "== L1: formatINR and formatDate, as the screens call them"
node --input-type=module -e "
import { formatINR } from '$repo/frontend/src/money.ts'
import { formatDate } from '$repo/frontend/src/format.ts'
for (const p of [8333300, 8333350, 15150000, 100, 50, -420000]) console.log('  formatINR(' + p + ') =', formatINR(p))
console.log('  formatDate(\"2026-09-10\") =', formatDate('2026-09-10'))
" 2>/dev/null

echo "== L3: allocateEqually, as the Payment form calls it"
node --input-type=module -e "
import { allocateEqually, percentagesOf } from '$repo/frontend/src/allocate.ts'
const r = (a) => a && a.map((p) => p / 100)
// In the form's order: the bangles first (newest first), then the chain.
const bangles = 15150000, chain = 8333300
console.log('  owed in all:', (bangles + chain) / 100)
for (const total of [660000, 660100, 660050, 10000100, 20000000, 24000000])
  console.log('  ' + total / 100 + ' over [bangles, chain]:', r(allocateEqually(total, [bangles, chain])))
console.log('  percentagesOf([3300, 3300], 6600):', percentagesOf([330000, 330000], 660000))
console.log('  percentagesOf([2200, 4401], 6601):', percentagesOf([220000, 440100], 660100))
" 2>/dev/null

node "$here/screens.mjs" "http://localhost:5199" "$repo"
kill $server $vite 2>/dev/null || true

echo "== L6: build the screens and serve them with a fresh book on :8765"
(cd "$repo/frontend" && npm run build >/dev/null 2>&1)
(cd "$repo/frontend/dist" && echo "  dist: $(find . -type f | wc -l | tr -d ' ') files, ocr/: $(find ocr -type f | wc -l | tr -d ' ') files, $(du -sh ocr | cut -f1)")
(cd "$repo/backend" && uv run python ../docs/sample-book/book.py "$pwa" >/dev/null)
REPO="$repo" BOOK="$pwa" node "$here/pwa.mjs"
