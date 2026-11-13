"""FastAPI app. Run with: uvicorn mortgage_backend.main:app"""

from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager
from datetime import date, datetime
from importlib.metadata import version
from pathlib import Path

from fastapi import FastAPI, Request, Response
from fastapi.concurrency import run_in_threadpool

from mortgage_backend.collateral import collateral, manual_value, mortgage_photos
from mortgage_backend.follow_up import (
    call_list,
    call_notes,
    call_sheets,
    message_settings,
    reminders,
)
from mortgage_backend.lending import (
    changes,
    closing,
    dashboard,
    default_terms,
    favours,
    mortgages,
    previews,
    projections,
    simulation,
)
from mortgage_backend.payments import (
    cash_limit,
    discount_confirmation,
    grace_period,
    payments,
    receipts,
    recording,
)
from mortgage_backend.people import customer_changes, customers
from mortgage_backend.platform import photos, updates
from mortgage_backend.platform.daily_run import DailyRun
from mortgage_backend.platform.db import (
    database_url_from_env,
    make_engine,
    migrate,
    photos_dir,
)
from mortgage_backend.platform.local_only import LocalOnly
from mortgage_backend.platform.screens import screens_dir_from_env, serve_screens
from mortgage_backend.platform.updates import (
    LatestRelease,
    UpdateCheck,
    latest_release_from_env,
)
from mortgage_backend.platform.upload_limit import UploadLimit
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
    screens_dir: Path | None = None,
    latest_release: LatestRelease | None = None,
) -> FastAPI:
    """The app; without a `backup_dir` it takes no Backups, with a `screens_dir` it serves
    the built screens too (as it does in Docker and without it), and without
    `latest_release` it never looks for a newer release."""
    engine = make_engine(database_url)
    backup = Backups(engine, database_url, backup_dir, backup_password, now)

    def sync_reminders(day: date) -> None:
        with engine.begin() as conn:
            reminders.sync(conn, day)

    daily_run = DailyRun(
        engine,
        today,
        jobs={"backup": backup.start_if_due, "reminders": sync_reminders},
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

    # The package version, checked against the root VERSION file in CI.
    app = FastAPI(
        title="Mortgage Management",
        version=version("mortgage-backend"),
        lifespan=lifespan,
    )
    app.state.engine = engine
    app.state.photos_dir = photos_dir(database_url)
    app.state.today = today
    app.state.now = now
    app.state.backups = backup
    app.state.daily_run = daily_run
    app.state.update_check = UpdateCheck(app.version, latest_release, now)
    # Inside the daily jobs' middleware, which would turn its refusal of a body sent
    # without its length into a 400; neither reads a body before it.
    app.add_middleware(UploadLimit)
    app.add_middleware(LocalOnly)  # outermost: refuses before anything is read or run

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
    app.include_router(cash_limit.router)
    app.include_router(discount_confirmation.router)
    app.include_router(grace_period.router)
    app.include_router(recording.router)
    app.include_router(changes.router)
    app.include_router(closing.router)
    app.include_router(favours.router)
    app.include_router(photos.router)
    app.include_router(manual_value.router)
    app.include_router(mortgage_photos.router)
    app.include_router(collateral.router)
    app.include_router(call_list.router)
    app.include_router(call_notes.router)
    app.include_router(call_sheets.router)
    app.include_router(dashboard.router)
    app.include_router(backups.router)
    app.include_router(audit.router)
    app.include_router(projections.router)
    app.include_router(simulation.router)
    app.include_router(previews.router)
    app.include_router(receipts.router)
    app.include_router(message_settings.router)
    app.include_router(reminders.router)
    app.include_router(updates.router)
    if screens_dir is not None:
        serve_screens(app, screens_dir)  # last, so it never answers for the API
    return app


app = create_app(
    database_url_from_env(),
    backup_dir=backup_dir_from_env(),
    backup_password=backup_password_from_env(),
    screens_dir=screens_dir_from_env(),
    latest_release=latest_release_from_env(),
)
