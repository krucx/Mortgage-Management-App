#!/bin/sh
# Every command output, header, count and failure chapter 014 quotes. From the repo root:
#
#   sh Documentation/onboarding/014-how-it-runs-on-the-lenders-laptop/scripts/run_throughs.sh
#
# Needs Docker, uv and Node. Everything happens in a temp folder: a fresh sample book, a
# copy of it for Docker, a copy of windows/ and of backend/ for the breaks. It never reads
# .env's folders, data/ or backups/, and leaves the clone as it was (frontend/dist is rebuilt,
# as serve.py needs it; it is not in git). Sections are headed L1, L2, L3-L5 and 99.
#
# The dev image is built under a name of its own (mortgage-management-app:onboarding-check),
# so a mortgage-management-app:dev you already run is never retagged. The project is
# mortgage-dev on port 8081, beside anything already on 8080.
set -eu
ROOT=$(git rev-parse --show-toplevel)
cd "$ROOT"
WORK=$(mktemp -d)
BOOK="$WORK/book"
COPY="$WORK/copy"
PORT=8081
SERVE=""

cat > "$WORK/rename.yml" <<'EOF'
services:
  app:
    image: mortgage-management-app:onboarding-check
EOF

# Every compose call gets the scratch folders, or Compose would read .env (trap #12).
dc() {
  DATA_DIR="$COPY/data" BACKUP_DIR="$COPY/backups" APP_PORT=$PORT \
    docker compose -p mortgage-dev -f docker-compose.yml -f docker-compose.dev.yml -f "$WORK/rename.yml" "$@"
}

cleanup() {
  dc down >/dev/null 2>&1 || true
  if [ -n "$SERVE" ]; then kill "$SERVE" 2>/dev/null || true; fi
  rm -rf "$WORK"
}
trap cleanup EXIT

wait_for() { for _ in $(seq 60); do curl -sf "$1" >/dev/null && return 0; sleep 1; done; return 1; }

# The status, Cache-Control and Content-Type of `path` on `port`.
headers() {
  printf '%-28s :%s  ' "$2" "$1"
  curl -sI "http://127.0.0.1:$1$2" | tr -d '\r' | awk '
    NR == 1 { printf "%s  ", $2 }
    tolower($1) == "cache-control:" { $1 = ""; printf "cache-control:%s  ", $0 }
    tolower($1) == "content-type:" { printf "type: %s", $2 }'
  echo
}

echo "== Building the sample book into $BOOK"
(cd backend && uv run python ../docs/sample-book/book.py "$BOOK" >/dev/null)
mkdir -p "$COPY/backups"
cp -R "$BOOK/data" "$COPY/"

echo
echo "== L1: the app in Docker, on a copy of the book"
dc up -d --build 2>&1 | tail -1
# The screens, not /api/: an /api/ request would run the day's jobs before we look.
wait_for "http://127.0.0.1:$PORT/"
dc ps --format '{{.Name}}  {{.Image}}  {{.Status}}  {{.Ports}}'
echo "-- logs (start-up):"
dc logs --no-log-prefix app
echo "-- /data and /backups inside the container:"
dc exec app sh -c 'ls /data /backups; echo "TZ=$TZ CHECK_FOR_UPDATES=$CHECK_FOR_UPDATES SCREENS_DIR=$SCREENS_DIR"; date'
echo "-- last_daily_run before the first /api/ request:"
sqlite3 "$COPY/data/mortgage.db" "select value from config where key = 'last_daily_run'"
TODAY=$(dc exec app date +%F)
echo "-- Meera's chain (Mortgage 2), closing today ($TODAY):"
curl -s "http://127.0.0.1:$PORT/api/mortgages/2/outstanding-on-closure?on=$TODAY"
echo
echo "-- last_daily_run after it:"
sqlite3 "$COPY/data/mortgage.db" "select value from config where key = 'last_daily_run'"
echo "-- the update check in a dev build:"
curl -s "http://127.0.0.1:$PORT/api/update"
echo
echo "-- a 21 MB upload:"
head -c 21000000 /dev/zero > "$WORK/big.bin"
curl -s -w '  HTTP %{http_code}\n' -X POST -F "file=@$WORK/big.bin;type=image/jpeg" \
  "http://127.0.0.1:$PORT/api/customers/1/photos"
echo "-- compose without DATA_DIR and BACKUP_DIR, in a folder with no .env:"
mkdir "$WORK/noenv"
cp docker-compose.yml docker-compose.dev.yml "$WORK/noenv/"
(cd "$WORK/noenv" && env -u DATA_DIR -u BACKUP_DIR \
  docker compose -p mortgage-dev -f docker-compose.yml -f docker-compose.dev.yml build app 2>&1 || true)
if [ -f .env ]; then
  echo "-- the same here, beside this clone's .env (config only; prints no paths):"
  env -u DATA_DIR -u BACKUP_DIR docker compose -p mortgage-dev -f docker-compose.yml \
    -f docker-compose.dev.yml config --format json |
    python3 -c 'import json, sys; v = json.load(sys.stdin)["services"]["app"]["volumes"]; print([(x["target"], "the scratch copy" if x["source"].startswith(sys.argv[1]) else "a folder from .env") for x in v])' "$WORK"
fi
echo "-- what the plain file runs:"
(cd "$WORK/noenv" && DATA_DIR="$COPY/data" BACKUP_DIR="$COPY/backups" docker compose -f docker-compose.yml config --format json |
  python3 -c 'import json, sys; a = json.load(sys.stdin)["services"]["app"]; print(a["image"], "| restart:", a["restart"], "| CHECK_FOR_UPDATES:", a["environment"]["CHECK_FOR_UPDATES"], "| port:", a["ports"][0]["host_ip"] + ":" + a["ports"][0]["published"])')

echo
echo "== L2: without Docker, serve.py on :8765 beside Docker on :$PORT"
(cd frontend && npm run build >/dev/null 2>&1)
(cd backend && exec uv run python ../docs/sample-book/serve.py "$BOOK" 8765) &
SERVE=$!
wait_for http://127.0.0.1:8765/api/backups
ASSET=$(curl -s http://127.0.0.1:8765/ | grep -o '/assets/[^"]*\.js' | head -n 1)
echo "-- the first script in each index.html: $ASSET and $(curl -s "http://127.0.0.1:$PORT/" | grep -o '/assets/[^"]*\.js' | head -n 1)"
for path in / /mortgages/2 /sw.js /registerSW.js /manifest.webmanifest "$ASSET" /assets/missing.js /api/no-such-thing; do
  headers 8765 "$path"
  headers $PORT "$path"
done
echo "-- stop each, then ask /api/customers:"
dc stop app 2>&1 | tail -1
curl -sS -o /dev/null -w 'HTTP %{http_code}\n' "http://127.0.0.1:$PORT/api/customers" 2>&1 || true
kill "$SERVE"
wait "$SERVE" 2>/dev/null || true
SERVE=""
curl -sS -o /dev/null -w 'HTTP %{http_code}\n' http://127.0.0.1:8765/api/customers 2>&1 || true
dc down 2>&1 | tail -1

echo
echo "== L3-L5: Pester, in the arm64 image from chapter 013"
if ! docker image inspect mm-pester >/dev/null 2>&1; then
  docker build -q -t mm-pester -f Documentation/onboarding/013-testing/scripts/pester.Dockerfile .
fi
docker run --rm -v "$ROOT:/repo:ro" -w /repo mm-pester pwsh -NoProfile -c 'Invoke-Pester windows/tests' 2>&1 |
  sed 's/\x1b\[[0-9;]*m//g' | grep -E '^\[|Tests Passed'
echo "-- non-ASCII bytes in windows/ (each should be 0):"
LC_ALL=C grep -c "$(printf '[\200-\377]')" windows/*.ps1 windows/*.bat windows/tests/*.ps1 || true
echo "-- docs/Setup.bat against windows/Setup.bat:"
cmp windows/Setup.bat docs/Setup.bat && echo "the same"

echo
echo "== 99: the link's regex loosened to (\\w+), in a copy of windows/"
mkdir "$WORK/win"
cp -R windows "$WORK/win/"
sed -i.orig 's/(start|update)\/?\$/(\\w+)\/?$/' "$WORK/win/windows/link.ps1"
sed -n 28p "$WORK/win/windows/link.ps1"
docker run --rm -v "$WORK/win:/repo:ro" -w /repo mm-pester pwsh -NoProfile -c 'Invoke-Pester windows/tests -Output Detailed' 2>&1 |
  sed 's/\x1b\[[0-9;]*m//g' | grep -E '\[-\]|Expected|Tests Passed'

echo
echo "== 99 extra: screens.py keeps every .js a year, in a copy of backend/"
rsync -a --exclude .venv --exclude .pytest_cache --exclude .mypy_cache backend/ "$WORK/backend/"
sed -i.orig 's/kept = path.startswith("assets\/")/kept = path.endswith(".js")/' \
  "$WORK/backend/src/mortgage_backend/platform/screens.py"
(cd "$WORK/backend" && uv run -q pytest tests/test_screens.py -q 2>&1 | grep -E '^E |FAILED|passed|failed' || true)
