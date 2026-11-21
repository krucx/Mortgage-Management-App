#!/bin/sh
# QA stack: runs this folder's own code as the Lender runs it, on scratch data, under a project
# of its own, so it can never touch the Lender's database, Backups or image.
#
#   scripts/qa-stack.sh up   --data DIR --backups DIR   # build from source, start, check
#   scripts/qa-stack.sh down                            # remove the containers and the image
#   scripts/qa-stack.sh test [--mode fresh|golden|work|all] [--ui]   # qa/features; 0 pass, 1 fail
#
# Optional: QA_PROJECT (default mortgage-qa, mortgage-qa-test for `test`; give each parallel run
# its own), QA_PORT (default: a free port). `down` never removes folders.
set -eu
ROOT=$(cd "$(dirname "$0")/.." && pwd -P)
cd "$ROOT"
PROJECT=${QA_PROJECT:-mortgage-qa}
IMAGE=mortgage-management-app:$PROJECT

die() { echo "qa-stack: $*" >&2; exit 1; }

# Absolute, symlink-free path of a folder that may not exist yet.
resolve() {
  case $1 in /*) p=$1 ;; *) p=$ROOT/$1 ;; esac
  d=$p; rest=
  while [ ! -d "$d" ] && [ "$d" != / ]; do rest=/$(basename "$d")$rest; d=$(dirname "$d"); done
  echo "$(cd "$d" && pwd -P)$rest"
}

# The folder .env gives for a key, as docker compose reads it (relative to this folder).
env_dir() {
  v=$(sed -n "s/^$1=//p" .env 2>/dev/null | tail -n 1)
  [ -n "$v" ] || v=$2
  resolve "$v"
}

dc() { docker compose -p "$PROJECT" "$@"; }

free_port() { python3 -c 'import socket; s = socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1])'; }

up() {
  DATA= BACKUPS=
  while [ $# -gt 0 ]; do
    case $1 in
      --data) DATA=${2:-}; shift 2 ;;
      --backups) BACKUPS=${2:-}; shift 2 ;;
      *) die "unknown option $1" ;;
    esac
  done
  [ -n "$DATA" ] && [ -n "$BACKUPS" ] || die "up needs --data DIR --backups DIR (scratch folders, never the Lender's)"
  DATA=$(resolve "$DATA"); BACKUPS=$(resolve "$BACKUPS")
  [ "$DATA" != "$BACKUPS" ] || die "--data and --backups must be different folders"
  for dir in "$DATA" "$BACKUPS"; do
    for real in "$(env_dir DATA_DIR ./data)" "$(env_dir BACKUP_DIR ./backups)"; do
      [ "$dir" != "$real" ] || die "$dir is a folder .env uses for the Lender's real data"
    done
  done
  [ -z "${DATA_DIR:-}${BACKUP_DIR:-}" ] || echo "qa-stack: ignoring DATA_DIR/BACKUP_DIR in the environment" >&2

  fresh=yes
  [ ! -d "$DATA" ] || [ -z "$(ls -A "$DATA")" ] || fresh=no
  mkdir -p "$DATA" "$BACKUPS"
  PORT=${QA_PORT:-$(free_port)}

  override=$(mktemp)
  trap 'rm -f "$override"' EXIT
  printf 'services:\n  app:\n    image: %s\n    container_name: %s\n' "$IMAGE" "$PROJECT" > "$override"

  # Passed on this call, never read from .env.
  DATA_DIR=$DATA BACKUP_DIR=$BACKUPS APP_PORT=$PORT BACKUP_PASSWORD= \
    dc -f docker-compose.yml -f docker-compose.dev.yml -f "$override" up -d --build

  mounted=$(docker inspect "$PROJECT" --format '{{range .Mounts}}{{if eq .Destination "/data"}}{{.Source}}{{end}}{{end}}')
  [ "$(resolve "$mounted")" = "$DATA" ] || die "container mounts '$mounted' as /data, not $DATA; run down"

  url=http://127.0.0.1:$PORT
  i=0
  until total=$(curl -fs "$url/api/customers" | python3 -c 'import json, sys; print(json.load(sys.stdin)["total"])' 2>/dev/null); do
    i=$((i + 1)); [ $i -lt 60 ] || die "the API did not answer at $url; see: docker logs $PROJECT"
    sleep 1
  done
  if [ "$fresh" = yes ] && [ "$total" != 0 ]; then
    die "scratch data was empty but the API lists $total Customers; run down"
  fi
  echo "qa-stack: $url serves scratch data ($DATA): $total Customers. Stop with: scripts/qa-stack.sh down"
}

down() {
  dc down --remove-orphans
  docker rmi "$IMAGE" 2>/dev/null || true
}

# Three apps on scratch volumes, the golden book, no data and the work app, and the Playwright
# runner that tests them at once (docker-compose.qa.yml). `--mode fresh` runs only the @fresh
# scenarios (no data), `golden` only the @golden ones (read the golden book), `work` only the
# rest (seed their own data), `all` every one. `--ui` serves Playwright's UI from the runner
# instead, until Ctrl-C. With QA_BUILD_CACHE=gha (CI), image layers are cached in the GitHub
# Actions cache.
run_tests() {
  MODE=all UI=
  while [ $# -gt 0 ]; do
    case $1 in
      --mode) MODE=${2:-}; shift 2 ;;
      --ui) UI=yes; shift ;;
      *) die "unknown option $1" ;;
    esac
  done
  case $MODE in fresh|golden|work|all) ;; *) die "--mode is fresh, golden, work or all" ;; esac
  PROJECT=${QA_PROJECT:-mortgage-qa-test}
  IMAGE=mortgage-management-app:$PROJECT
  PORT=${QA_PORT:-$(free_port)}
  [ "$MODE" = all ] && SPECS= || SPECS=$MODE

  override=$(mktemp)
  trap 'qa_compose down -v --remove-orphans || true; docker rmi "$IMAGE" >/dev/null 2>&1 || true; rm -f "$override"' EXIT
  trap 'exit 1' INT TERM
  {
    printf 'services:\n  app:\n    image: %s\n' "$IMAGE"
    if [ "${QA_BUILD_CACHE:-}" = gha ]; then
      printf '    build:\n      cache_from: ["type=gha,scope=qa-app"]\n      cache_to: ["type=gha,mode=max,scope=qa-app"]\n'
      printf '  qa-runner:\n    build:\n      cache_from: ["type=gha,scope=qa-runner"]\n      cache_to: ["type=gha,mode=max,scope=qa-runner"]\n'
    fi
  } > "$override"

  if [ -n "$UI" ]; then
    ui=$(free_port)
    echo "qa-stack: Playwright UI at http://127.0.0.1:$ui once built; stop with Ctrl-C"
    qa_compose run --rm --build -p "127.0.0.1:$ui:$ui" qa-runner npx playwright test --ui-host=0.0.0.0 --ui-port="$ui"
    return
  fi

  echo "qa-stack: $MODE scenarios"
  qa_compose up --build --exit-code-from qa-runner --attach qa-runner || die "tests failed; see qa/test-results"
  echo "qa-stack: passed (--mode $MODE)"
}

# Compose with the QA overlay, for run_tests (it sets PORT, SPECS, IMAGE and override). The base
# file requires DATA_DIR and BACKUP_DIR; the overlay mounts its own scratch volumes over them, so
# they never reach the Lender's folders.
qa_compose() {
  DATA_DIR=qa-data BACKUP_DIR=qa-backups APP_PORT=$PORT BACKUP_PASSWORD= QA_SPECS=$SPECS QA_APP_IMAGE=$IMAGE \
    dc -f docker-compose.yml -f docker-compose.dev.yml -f docker-compose.qa.yml -f "$override" "$@"
}

case ${1:-} in
  up) shift; up "$@" ;;
  down) down ;;
  test) shift; run_tests "$@" ;;
  *) die "usage: scripts/qa-stack.sh up --data DIR --backups DIR | down | test [--mode fresh|golden|work|all] [--ui]" ;;
esac
