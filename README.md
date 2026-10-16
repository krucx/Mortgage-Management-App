# Mortgage-Management-App

App for a jewellery Lender to manage Mortgages, Payments and follow-ups. It runs entirely on the Lender's own laptop. Domain terms are defined in [GLOSSARY.md](GLOSSARY.md); key decisions are in [docs/adr](docs/adr).

## Running it (Lender)

1. Install [Docker Desktop](https://www.docker.com/products/docker-desktop/) and start it.
2. Get this folder onto the laptop (`git clone` or download).
3. Copy `.env.example` to `.env` and adjust it:
   - `DATA_DIR`: folder for the database and photos.
   - `BACKUP_DIR`: point it at a Google Drive / iCloud synced folder.
   - `TZ`: your time zone (default `Asia/Kolkata`).
4. In this folder, run:

   ```sh
   docker compose up -d
   ```

5. Open <http://localhost:8080> (or whatever `APP_PORT` is set to).

The app restarts by itself with Docker. Database updates run automatically when the app starts. Your data lives only in `DATA_DIR`, never inside Docker.

### Updating

```sh
git pull
docker compose up -d --build
```

## Development

Hot reload for both halves:

```sh
docker compose -f compose.yml -f compose.dev.yml up --build
```

- `backend/`: FastAPI + SQLite (SQLAlchemy, Alembic migrations), managed with [uv](https://docs.astral.sh/uv/).
- `frontend/`: React + TypeScript + Vite, served by nginx in production.

### Tests and type checks

```sh
cd backend && uv run pytest && uv run mypy src
cd frontend && npm test && npm run typecheck
```

### Database migrations

Add a new revision under `backend/src/mortgage_backend/migrations/versions/`. Migrations run on every backend start.
