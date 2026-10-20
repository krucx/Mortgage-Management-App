# Mortgage-Management-App

App for a jewellery Lender to manage Mortgages, Payments and follow-ups. It runs entirely on the Lender's own laptop. Domain terms are defined in [GLOSSARY.md](GLOSSARY.md); key decisions are in [Documentation/adr](Documentation/adr).

What changed in each version is in [CHANGELOG.md](CHANGELOG.md). A walkthrough of every page, and the app told as a story, are at <https://krucx.github.io/Mortgage-Management-App/>.

## Running it (Lender)

1. Install [Docker Desktop](https://www.docker.com/products/docker-desktop/) and start it.
2. Get this folder onto the laptop (`git clone` or download).
3. Copy `.env.example` to `.env` and adjust it:
   - `DATA_DIR`: folder for the database and photos.
   - `BACKUP_DIR`: point it at a Google Drive / iCloud synced folder.
   - `BACKUP_PASSWORD`: the password for the Backup zips. Write it down somewhere safe.
   - `TZ`: your time zone (default `Asia/Kolkata`).
4. In this folder, run:

   ```sh
   docker compose up -d
   ```

5. Open <http://localhost:8080> (or whatever `APP_PORT` is set to).

The app restarts by itself with Docker. Database updates run automatically when the app starts. Your data lives only in `DATA_DIR`, never inside Docker.

### Installing it as an app

The app can be installed like a desktop or phone app, with its own icon and window. In
Chrome or Edge, open it and choose **Install** in the address bar (Safari: **File → Add
to Dock**). It opens even when Docker is stopped, then says the server can't be reached
until Docker is running again. Figures always come fresh from the server: nothing owed
is kept on the device. Whenever the server is up, the app itself comes from it too, so an
update shows the next time the app is opened.

### Backups

Once a week (on the first use of the day it falls due) the app writes
`mortgage-backup-<date>-<time>.zip` to `BACKUP_DIR`, holding the database and photos,
and keeps the last few (4 by default, see Settings). It also takes one, marked
`-before-update`, before any database update; if that Backup fails the app does not
start, so the data is never updated without one (`docker compose logs backend` says why). Settings shows the last Backup and has a
**Back up now** button.

To restore:

1. `docker compose down`
2. Open the zip with the `BACKUP_PASSWORD` (Explorer, Finder, 7-Zip or `unzip` all work).
3. Replace `mortgage.db` and the `photos` folder in `DATA_DIR` with the ones from the zip.
4. `docker compose up -d`

### Updating

```sh
git pull
docker compose up -d --build
```

### Published images

Each release is published to Docker Hub as
[`krucx11/mortgage-management-app`](https://hub.docker.com/r/krucx11/mortgage-management-app),
for Intel and Apple-silicon machines:

| Image   | This release      | Newest release    |
| ------- | ----------------- | ----------------- |
| Backend | `backend-<version>` (e.g. `backend-1.2.0`) | `backend-latest` |
| UI      | `ui-<version>` (e.g. `ui-1.2.0`)           | `ui-latest`      |

They are built by `.github/workflows/release.yml` when a version tag (e.g. `1.2.0`) is
pushed, after the tests pass. The `-latest` tags move only when the pushed version is the
highest so far, so a fix for an older version doesn't take them back. The tag must match the version in `backend/pyproject.toml`
and `frontend/package.json`. The workflow needs two repository secrets,
`DOCKERHUB_USERNAME` and `DOCKERHUB_TOKEN` (a Docker Hub access token with Read & Write).

## Development

Run the two halves directly for hot reload (no Docker needed):

```sh
cd backend && uv run uvicorn mortgage_backend.main:app --reload   # API on :8000
cd frontend && npm install && npm run dev                          # UI on :5173, proxies /api to :8000
```

- `backend/`: FastAPI + SQLite (SQLAlchemy, Alembic migrations), managed with [uv](https://docs.astral.sh/uv/).
- `frontend/`: React + TypeScript + Vite, served by nginx in production.

### Tests and type checks

```sh
cd backend && uv run pytest && uv run mypy src
cd frontend && npm test && npm run typecheck
```

### API types

The frontend's request and response types are generated from the backend's models, never written by hand. After changing a model the backend returns or accepts, run:

```sh
cd frontend && npm run gen:types
```

and commit `frontend/openapi.json` and `frontend/src/api.gen.ts`. The backend tests fail if `openapi.json` is stale, and the frontend tests fail if `api.gen.ts` doesn't match it.

### Database migrations

Add a new revision under `backend/src/mortgage_backend/migrations/versions/`. Migrations run every time the backend starts.
