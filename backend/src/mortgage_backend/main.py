"""FastAPI app. Run with: uvicorn mortgage_backend.main:app"""

from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager
from datetime import date, datetime
from importlib.metadata import version
from pathlib import Path

from fastapi import FastAPI, Request, Response
from fastapi.concurrency import run_in_threadpool

from mortgage_backend.collateral import collateral
from mortgage_backend.follow_up import call_list, call_notes, message_settings, notices
from mortgage_backend.lending import (
    changes,
    closing,
    dashboard,
    default_terms,
    mortgages,
    previews,
    projections,
)
from mortgage_backend.payments import payments, receipts
from mortgage_backend.people import customer_changes, customers
from mortgage_backend.platform import photos
from mortgage_backend.platform.daily_run import DailyRun
from mortgage_backend.platform.db import (
    database_url_from_env,
    make_engine,
    migrate,
    photos_dir,
)
from mortgage_backend.safekeeping import audit, backups
from mortgage_backend.safekeeping.backups import (
    Backups,
    backup_dir_from_env,
    backup_password_from_env,
)


def create_app(
    database_url: str,
    today: Callable[[], date] = date.today,
    now: Callable[[], datetime] = datetime.now,
    backup_dir: Path | None = None,
    backup_password: str = "",
) -> FastAPI:
    """The app; without a `backup_dir` it takes no Backups."""
    engine = make_engine(database_url)
    backup = Backups(engine, database_url, backup_dir, backup_password, now)

    def sync_notices(day: date) -> None:
        with engine.begin() as conn:
            notices.sync(conn, day)

    daily_run = DailyRun(
        engine, today, jobs=[backup.start_if_due, sync_notices]
    )

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        backup.clean_leftovers()
        # Every start brings the schema up to date, backing up the old one first.
        migrate(
            database_url,
            before_update=(
                (lambda: backup.make("before-update")) if backup.backup_dir else None
            ),
        )
        # Also retries a weekly Backup that a shutdown interrupted.
        backup.start_if_due(today())
        yield
        backup.wait(timeout=8)  # let a running Backup finish if it can

    # The version in pyproject.toml, reported in the API schema.
    app = FastAPI(
        title="Mortgage Management", version=version("mortgage-backend"), lifespan=lifespan
    )
    app.state.engine = engine
    app.state.photos_dir = photos_dir(database_url)
    app.state.today = today
    app.state.now = now
    app.state.backups = backup
    app.state.daily_run = daily_run

    @app.middleware("http")
    async def run_daily_jobs(
        request: Request, call_next: Callable[[Request], Awaitable[Response]]
    ) -> Response:
        if request.url.path.startswith("/api/"):
            await run_in_threadpool(daily_run.run_if_due)
        return await call_next(request)

    app.include_router(default_terms.router)
    app.include_router(customers.router)
    app.include_router(customer_changes.router)
    app.include_router(mortgages.router)
    app.include_router(payments.router)
    app.include_router(changes.router)
    app.include_router(closing.router)
    app.include_router(photos.router)
    app.include_router(collateral.router)
    app.include_router(call_list.router)
    app.include_router(call_notes.router)
    app.include_router(dashboard.router)
    app.include_router(backups.router)
    app.include_router(audit.router)
    app.include_router(projections.router)
    app.include_router(previews.router)
    app.include_router(receipts.router)
    app.include_router(message_settings.router)
    app.include_router(notices.router)
    return app


app = create_app(
    database_url_from_env(),
    backup_dir=backup_dir_from_env(),
    backup_password=backup_password_from_env(),
)
