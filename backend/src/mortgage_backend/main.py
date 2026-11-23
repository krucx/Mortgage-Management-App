"""FastAPI app. Run with: uvicorn mortgage_backend.main:app"""

from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager
from datetime import date, datetime
from importlib.metadata import version
from pathlib import Path

from fastapi import APIRouter, FastAPI, HTTPException, Request, Response
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import JSONResponse

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
from mortgage_backend.platform import health, photos, updates
from mortgage_backend.platform.clock import get_today
from mortgage_backend.platform.daily_run import DailyRun
from mortgage_backend.platform.db import (
    database_url_from_env,
    make_engine,
    migrate,
    photos_dir,
    write_transaction,
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
        with write_transaction(engine) as conn:
            reminders.sync(conn, day)

    daily_run = DailyRun(
        engine, jobs={"backup": backup.start_if_due, "reminders": sync_reminders}
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
        # The health probe reads no Customer data, so it runs no job that would.
        if request.url.path.startswith("/api/") and request.url.path != "/api/health":
            # The request's date, so in QA mode `X-QA-Clock` runs that day's jobs too.
            try:
                day = get_today(request)
            except HTTPException as error:
                return JSONResponse({"detail": error.detail}, error.status_code)
            await run_in_threadpool(daily_run.run_if_due, day)
        return await call_next(request)

    api_router = APIRouter(prefix="/api")
    api_router.include_router(default_terms.router)
    api_router.include_router(customers.router)
    api_router.include_router(customer_changes.router)
    api_router.include_router(mortgages.router)
    api_router.include_router(payments.router)
    api_router.include_router(cash_limit.router)
    api_router.include_router(discount_confirmation.router)
    api_router.include_router(grace_period.router)
    api_router.include_router(recording.router)
    api_router.include_router(changes.router)
    api_router.include_router(closing.router)
    api_router.include_router(favours.router)
    api_router.include_router(photos.router)
    api_router.include_router(manual_value.router)
    api_router.include_router(mortgage_photos.router)
    api_router.include_router(collateral.router)
    api_router.include_router(call_list.router)
    api_router.include_router(call_notes.router)
    api_router.include_router(call_sheets.router)
    api_router.include_router(dashboard.router)
    api_router.include_router(backups.router)
    api_router.include_router(audit.router)
    api_router.include_router(projections.router)
    api_router.include_router(simulation.router)
    api_router.include_router(previews.router)
    api_router.include_router(receipts.router)
    api_router.include_router(message_settings.router)
    api_router.include_router(reminders.router)
    api_router.include_router(updates.router)
    api_router.include_router(health.router)
    app.include_router(api_router)
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
