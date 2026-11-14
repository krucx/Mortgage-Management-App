# The app as one image (Documentation/adr/0013): the backend, serving the built screens too.
#   docker build -t mortgage-management-app:dev .
# Built from the repository root, the only folder that holds both backend/ and frontend/.

# The built screens are the same files on every platform, so they are built once, on the
# machine doing the build: npm ci never runs under emulation for another platform.
FROM --platform=$BUILDPLATFORM node:24-alpine AS screens
WORKDIR /frontend
COPY VERSION /VERSION
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM python:3.13-slim

COPY --from=ghcr.io/astral-sh/uv:0.12 /uv /usr/local/bin/uv

# zip writes the password-protected Backups.
RUN apt-get update && apt-get install -y --no-install-recommends zip \
    && rm -rf /var/lib/apt/lists/*

# Runs as this fixed, unprivileged id rather than root (architecture review pass 7). The
# id is fixed so an existing Linux host's DATA_DIR and BACKUP_DIR can be matched to it
# exactly (see README's Updating section); Docker Desktop (Mac, Windows) needs no change.
RUN groupadd --gid 1000 app && useradd --uid 1000 --gid app --no-create-home --shell /usr/sbin/nologin app

WORKDIR /app

# Attribution travels with the distributed image (Apache-2.0 section 4; fpdf2 LGPL-3.0).
COPY LICENSE NOTICE /app/
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy PATH="/app/.venv/bin:$PATH"

COPY backend/pyproject.toml backend/uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project

COPY backend/src ./src
RUN uv sync --frozen --no-dev

COPY --from=screens /frontend/dist ./screens

RUN chown -R app:app /app
USER app

ENV DATA_DIR=/data BACKUP_DIR=/backups SCREENS_DIR=/app/screens
EXPOSE 8000
# Migrations run on app start.
CMD ["uvicorn", "mortgage_backend.main:app", "--host", "0.0.0.0", "--port", "8000"]
