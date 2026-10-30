# Mortgage-Management-App

App for a jewellery Lender to manage Mortgages, Payments and follow-ups. It runs entirely on the Lender's own laptop. Domain terms are defined in [GLOSSARY.md](GLOSSARY.md); key decisions are in [Documentation/adr](Documentation/adr).

What changed in each version is in [CHANGELOG.md](CHANGELOG.md). The documentation (features, workflows and the rules behind the figures), a walkthrough of every page, the app told as a story, and an install guide are at <https://krucx.github.io/Mortgage-Management-App/>.

## Running it (Lender)

### On Windows: double-click setup

The [install guide](https://krucx.github.io/Mortgage-Management-App/install.html) has the
download and every step, for your own computer. In short:

1. Download [`Setup.bat`](https://krucx.github.io/Mortgage-Management-App/Setup.bat)
   and double-click it. If Windows warns about an
   unrecognised app, choose **More info → Run anyway**.
2. Choose where the database and photos should live, where Backups should go, answer
   any other questions (Enter keeps the default each time), and say yes to start it.
3. From then on, open the **Mortgage Management** shortcut on the Desktop, or the
   installed app's icon (below): when the app isn't running, it offers a **Start
   Mortgage Management** button.

Setup puts everything in `%USERPROFILE%\MortgageManagement`: `versions` (each
version's code, in a folder of its own), `app` (a link to the version that runs, with its
`.env`), `data` (database and photos, unless you chose another folder) and `backups`
(unless you chose another folder, such as a Google Drive or OneDrive one). The selected
data folder is saved as `DATA_DIR` in `app\.env` and reused by every run; it must be
outside `app` and `versions`. Setup creates the folder if needed. It sets up the latest
release:

- **With Docker Desktop installed**, the app runs in Docker, as below. Setup asks for a
  Backup password.
- **Without Docker**, it runs directly on the PC. Setup installs
  [uv](https://docs.astral.sh/uv/), which brings the right Python, and the backend's
  packages; a release comes with its screens built, which the backend serves itself, so no
  Node.js is needed (Setup installs it through winget only to set up unreleased code,
  `-Ref <branch or commit>`). The shortcut's window must stay open while the app is used;
  closing it stops the app. Backups are plain zips, without a password: Windows has
  nothing built in that makes password zips.

Run `Setup.bat` again to update to the newest release; your `.env`, data and Backups are
kept. It uses git when it is installed, and otherwise downloads the release from GitHub.
It installs the new version beside the one you have and switches to it only once it
starts, leaving it running; if anything fails it says **Update failed; still on x.y.z**
and the version you had stays. The version before is kept in `versions`, older ones are
removed. Without internet it starts the version you have instead (the first setup needs
internet).
To move the data later, stop the app, move `mortgage.db` and `photos` together to the
new folder, then update `DATA_DIR` in `app\.env` before starting the app again.

To remove the app from the PC, double-click `Uninstall.bat` in
`%USERPROFILE%\MortgageManagement\app\windows` and type `yes`. It stops the app and moves
the latest Backup into **Documents**; only then does it delete the Docker images, the
Desktop shortcut and `mortgage-management://` link, the data and the `MortgageManagement`
folder. A Backup folder you chose outside it (Google Drive, OneDrive) is left as it is
(the latest Backup is copied from it instead), and so are Node.js and uv.

### Anywhere with Docker

1. Install [Docker Desktop](https://www.docker.com/products/docker-desktop/) and start it.
2. Get this folder onto the laptop (`git clone` or download).
3. Copy `.env.example` to `.env` and adjust it:
   - `DATA_DIR`: folder for the database and photos.
   - `BACKUP_DIR`: point it at a Google Drive / iCloud synced folder.
   - `BACKUP_PASSWORD`: the password for the Backup zips. Write it down somewhere safe.
   - `TZ`: your time zone (default `Asia/Kolkata`).
   - `APP_VERSION`: leave empty to run the latest release, or set one (e.g. `1.2.0`).
4. In this folder, run:

   ```sh
   docker compose up -d
   ```

5. Open <http://localhost:8080> (or whatever `APP_PORT` is set to).

The first start downloads the app from Docker Hub (see Published images); nothing is
built on the laptop. The app restarts by itself with Docker. Database updates run automatically when the app starts. Your data lives only in `DATA_DIR`, never inside Docker.

### Installing it as an app

The app can be installed like a desktop or phone app, with its own icon and window. In
Chrome or Edge, open it and choose **Install** in the address bar (Safari: **File → Add to
Dock**). It opens even when the server is stopped. On Windows it then offers **Start
Mortgage Management**, which starts the app through the `mortgage-management://` link
Setup registers (Windows asks once whether to open it) and loads it as soon as it answers;
elsewhere, start the server and the app loads by itself. Figures always come fresh from
the server: nothing owed is kept on the device. Whenever the server is up, the app itself
comes from it too, so an update shows the next time the app is opened.

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

When a newer release is out, the app says so in a banner with what's new (it asks GitHub
at most once a day). On Windows, **Install now** runs Setup for it (Windows asks once
whether to open it) and the app reloads by itself once the new version runs; **Later**
hides the banner until the next release. Or double-click `Setup.bat` again (it is also in
`%USERPROFILE%\MortgageManagement\app\windows`): it updates to the newest release, with
or without Docker, and keeps the `.env`, data and Backups; when you have the newest
already, it downloads nothing and just starts it. If the new version had already
updated the database when it failed to start, Setup says which `-before-update` Backup
to restore should the version you had not start on it. Elsewhere:

```sh
git pull               # this folder's compose file and notes
docker compose pull    # the newest images (or those for APP_VERSION)
docker compose up -d
```

To go back to an earlier release, set `APP_VERSION` in `.env` and run the same two
`docker compose` commands. A newer release may have updated the database: restore the
Backup taken before that update (see Backups) when going back past one.

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
highest so far, so a fix for an older version doesn't take them back. The tag must match
the version in `backend/pyproject.toml` and `frontend/package.json`. The workflow needs two repository secrets,
`DOCKERHUB_USERNAME` and `DOCKERHUB_TOKEN` (a Docker Hub access token with Read & Write).

## Development

Run the two halves directly for hot reload (no Docker needed):

```sh
cd backend && uv run uvicorn mortgage_backend.main:app --reload   # API on :8000
cd frontend && npm install && npm run dev                          # UI on :5173, proxies /api to :8000
```

To try this folder's own code as the Lender runs it, build the images locally instead
of pulling them. `docker-compose.dev.yml` builds both under their own names
(`mortgage-management-app-backend:dev`, `mortgage-management-app-ui:dev`), so the images
from Docker Hub are left as they are:

```sh
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --build
```

Use a scratch `DATA_DIR` and `BACKUP_DIR` (on every `docker compose` command) when
trying unreleased code, so it never runs a migration on real data. Plain
`docker compose up -d` goes back to the published images.

The Windows setup lives in `windows/`: `Setup.bat` → `setup.ps1` (gets the code) →
`install.ps1` (Docker or local, `.env`, installs, shortcut, `mortgage-management://`
link), `Run.bat` → `run.ps1`, `link.ps1` (opens the link: `mortgage-management://start`
runs `Run.bat`, `mortgage-management://update` runs Setup; see Documentation/adr/0008),
and `Uninstall.bat` → `uninstall.ps1`. `common.ps1` holds what they share; `windows/tests`
checks their decisions with Pester. The `windows` job in `.github/workflows/test.yml` runs
the setup without Docker end to end on a Windows runner, then the uninstall. `setup.ps1
-Ref <branch or commit>` sets up code that isn't released yet.

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
