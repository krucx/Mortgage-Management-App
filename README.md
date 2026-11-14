# Mortgage-Management-App

App for a jewellery Lender to manage Mortgages, Payments and follow-ups. It runs entirely on the Lender's own laptop. System architecture is documented in [Documentation/ARCHITECTURE.md](Documentation/ARCHITECTURE.md); domain terms are defined in [Documentation/GLOSSARY.md](Documentation/GLOSSARY.md); key decisions are in [Documentation/adr](Documentation/adr).

Contributors and coding agents: follow [CONTRIBUTING.md](CONTRIBUTING.md) for branch,
pull request, review, and merge requirements, and use the
[release checklist](Documentation/RELEASE_CHECKLIST.md) for every release.

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
  nothing built in that makes password zips. They hold Customers' ID Photos, so keep the
  Backup folder private.

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
4. On a Linux host, create `DATA_DIR` and `BACKUP_DIR` and give them to the image's
   fixed, unprivileged user (uid:gid 1000:1000, Documentation/adr/0013) before the first
   start, or the app can't write to them (Docker Desktop on Mac and Windows needs no
   such step):

   ```sh
   mkdir -p <DATA_DIR> <BACKUP_DIR>
   sudo chown -R 1000:1000 <DATA_DIR> <BACKUP_DIR>
   ```

5. In this folder, run:

   ```sh
   docker compose up -d
   ```

6. Open <http://localhost:8080> (or whatever `APP_PORT` is set to).

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
`mortgage-backup-<date>-<time>.zip` to `BACKUP_DIR`, holding the database and photos
(Customers' ID Photos among them: set `BACKUP_PASSWORD`, or keep `BACKUP_DIR` private),
and keeps the last few (4 by default, see Settings). It also takes one, marked
`-before-update`, before any database update; if that Backup fails the app does not
start, so the data is never updated without one (`docker compose logs app` says why). Settings shows the last Backup and has a
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
to restore should the version you had not start on it. Elsewhere, on a Linux host
updating from a release before this change, first give uid:gid 1000:1000 (the image's
fixed, unprivileged user, Documentation/adr/0013) ownership of `DATA_DIR` and
`BACKUP_DIR` (Docker Desktop on Mac and Windows needs no such step):

```sh
sudo chown -R 1000:1000 <DATA_DIR> <BACKUP_DIR>
```

Skipping it on Linux stops the app outright if `DATA_DIR` isn't owned by that uid:gid;
if only `BACKUP_DIR` isn't, the app still starts but every Backup then fails silently
(see Settings, or `docker compose logs app`) — and would block starting a future
release that backs up before migrating.

```sh
git pull                             # this folder's compose file and notes
docker compose pull                  # the newest image (or the one for APP_VERSION)
docker compose up -d --remove-orphans
```

`--remove-orphans` removes the containers of a release that ran other services (before
3.4.0, a `backend` and a `frontend`), which would otherwise keep holding the port.

To go back to an earlier release, set `APP_VERSION` in `.env` and run the same two
`docker compose` commands. To go back before 3.4.0, which was two images, first
`git checkout <version>` (e.g. `git checkout 3.3.0`) for that release's own compose file.
A newer release may have updated the database: restore the Backup taken before that
update (see Backups) when going back past one.

### Published images

Each release is published to Docker Hub as one image,
[`krucx11/mortgage-management-app`](https://hub.docker.com/r/krucx11/mortgage-management-app),
for Intel and Apple-silicon machines:

| This release                | Newest release |
| --------------------------- | -------------- |
| `<version>` (e.g. `3.4.0`)  | `latest`       |

Releases before 3.4.0 were two images, tagged `backend-<version>` and `ui-<version>`;
those tags stay on Docker Hub, so going back to one of them still works, with its own
compose file (see Updating).

It is built by `.github/workflows/release.yml` after an approved release candidate PR
is merged. `.github/workflows/publish-release.yml` creates the matching version tag and
dispatches the release workflow after checking the approval and PR checks. The `latest`
tag moves only when the published version is the highest so far, so a fix for an older
version doesn't take it back. The tag must match
the root `VERSION` file. Backend and frontend package metadata and the current-version
labels in the maintained docs are checked against it by `.github/scripts/check-version.mjs`.
When preparing a release, add reviewed notes under `Unreleased` and run the
**Prepare release candidate** workflow. It updates `VERSION`, package metadata, the
generated API schema, current-version docs labels and lockfile on the candidate branch,
then opens a PR after preflight passes. The frontend reads
`VERSION` when building; Python package metadata is generated into `backend/pyproject.toml`
because the app reports its installed package version. Coding agents should use the same
steps and preserve historical changelog entries and examples. The publisher needs two
repository secrets,
`DOCKERHUB_USERNAME` and `DOCKERHUB_TOKEN` (a Docker Hub access token with Read & Write).

## Development

Run the two halves directly for hot reload (no Docker needed):

```sh
cd backend && uv run uvicorn mortgage_backend.main:app --reload   # API on :8000
cd frontend && npm install && npm run dev                          # UI on :5173, proxies /api to :8000
```

To try this folder's own code as the Lender runs it, build the image locally instead
of pulling it. The app is one image (Documentation/adr/0013): the root `Dockerfile` builds
the screens, and the backend serves them and `/api` on one port, as it does without
Docker. `docker-compose.dev.yml` builds it under its own name
(`mortgage-management-app:dev`), so the image from Docker Hub is left as it is:

```sh
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --build
```

Use a scratch `DATA_DIR` and `BACKUP_DIR` (on every `docker compose` command) when
trying unreleased code, so it never runs a migration on real data. Plain
`docker compose up -d` goes back to the published image.

`scripts/qa-stack.sh` makes that the only path for QA: `scripts/qa-stack.sh up --data DIR
--backups DIR` refuses unless both are scratch folders (not the ones in `.env`), builds
from source under its own project and a free port, and checks the API is serving the scratch
data. `scripts/qa-stack.sh down` removes its containers and image, never the folders. Set
`QA_PROJECT` to run several at once.

The Windows setup lives in `windows/`: `Setup.bat` → `setup.ps1` (gets the code) →
`install.ps1` (Docker or local, `.env`, installs, shortcut, `mortgage-management://`
link), `Run.bat` → `run.ps1`, `link.ps1` (opens the link: `mortgage-management://start`
runs `Run.bat`, `mortgage-management://update` runs Setup; see Documentation/adr/0008),
and `Uninstall.bat` → `uninstall.ps1`. `common.ps1` holds what they share; `windows/tests`
checks their decisions with Pester. The `windows` job in `.github/workflows/test.yml` runs
the setup without Docker end to end on a Windows runner, then the uninstall. `setup.ps1
-Ref <branch or commit>` sets up code that isn't released yet.

Pull requests targeting `main` run the `backend` and `frontend` test jobs in
`.github/workflows/test.yml`. Their summaries show line coverage and their artifacts
retain the detailed reports. The main ruleset requires the backend, frontend, image,
Windows, and CodeQL checks, as well as CodeRabbit. The importable ruleset template
specifies one human approval and blocks direct pushes; see
[CONTRIBUTING.md](CONTRIBUTING.md) for required check names, automated review setup,
and plan limitations. A failed test,
missing coverage report, invalid coverage summary, or failed report upload blocks the
normal merge path. Backend line coverage must be at least 90%, and frontend line coverage
must be at least 80%. Review the coverage artifacts for details; pull request summaries
show each job's coverage total.

The GitHub Pages screenshots are taken from an invented sample book made through the app's
own API: `docs/sample-book/run.sh` retakes them all (see its README).

- `backend/`: FastAPI + SQLite (SQLAlchemy, Alembic migrations), managed with [uv](https://docs.astral.sh/uv/).
- `frontend/`: React + TypeScript + Vite; its built screens are served by the backend, in Docker and without it.

### Tests, lint and type checks

```sh
cd backend && uv run ruff check . && uv run ruff format --check .
cd backend && COVERAGE_CORE=sysmon uv run pytest -n auto && uv run mypy src
cd frontend && npm test && npm run typecheck
```

The backend tests use `pytest-xdist` to run in parallel. `COVERAGE_CORE=sysmon`
keeps coverage collection compatible with that parallel run. CI additionally
uses pytest-cov to retain XML and HTML coverage reports. `ruff format .` applies
the backend formatting and `ruff check . --fix` the safe lint fixes.

### API types

The frontend's request and response types are generated from the backend's models, never written by hand. After changing a model the backend returns or accepts, run:

```sh
cd frontend && npm run gen:types
```

and commit `frontend/openapi.json` and `frontend/src/api.gen.ts`. The backend tests fail if `openapi.json` is stale, and the frontend tests fail if `api.gen.ts` doesn't match it.

### Database migrations

Add a new revision under `backend/src/mortgage_backend/migrations/versions/`. Migrations run every time the backend starts.

## Licence

Mortgage-Management-App is Copyright 2026 Kritarth Jain and is released under the
[Apache License 2.0](LICENSE). You may use, modify, and distribute it under those terms;
see [LICENSE](LICENSE) for the full text.

By submitting a contribution, you agree that it is licensed under the Apache License 2.0, as described in section 5 of the licence.

Third-party components keep their own licences. The app uses
[fpdf2](https://github.com/py-pdf/fpdf2) (LGPL-3.0-only), unmodified, to generate PDF call
sheets; its notice and the attribution for this project are in [NOTICE](NOTICE).
