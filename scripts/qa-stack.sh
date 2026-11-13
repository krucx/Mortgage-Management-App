#!/bin/sh
# QA stack: runs this folder's own code as the Lender runs it, on scratch data, under a project
# of its own, so it can never touch the Lender's database, Backups or image.
#
#   scripts/qa-stack.sh up   --data DIR --backups DIR   # build from source, start, check
#   scripts/qa-stack.sh down                            # remove the containers and the image
#
# Optional: QA_PROJECT (default mortgage-qa; give each parallel run its own), QA_PORT (default:
# a free port). `down` never removes folders.
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
  PORT=${QA_PORT:-$(python3 -c 'import socket; s = socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1])')}

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

case ${1:-} in
  up) shift; up "$@" ;;
  down) down ;;
  *) die "usage: scripts/qa-stack.sh up --data DIR --backups DIR | down" ;;
esac
