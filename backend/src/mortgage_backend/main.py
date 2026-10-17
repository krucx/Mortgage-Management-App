"""FastAPI app. Run with: uvicorn mortgage_backend.main:app"""

from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager
from datetime import date, datetime
from pathlib import Path

from fastapi import APIRouter, FastAPI, Request, Response
from fastapi.concurrency import run_in_threadpool

from mortgage_backend import (
    audit,
    backups,
    call_list,
    closing,
    collateral,
    customers,
    mortgages,
    payments,
    photos,
    projections,
    term_changes,
)
from mortgage_backend.backups import (
    Backups,
    backup_dir_from_env,
    backup_password_from_env,
)
from mortgage_backend.daily_run import DailyRun
from mortgage_backend.db import (
    EngineDep,
    database_url_from_env,
    make_engine,
    migrate,
    photos_dir,
)
from mortgage_backend.default_terms import get_default_terms, set_default_terms
from mortgage_backend.terms import Terms

router = APIRouter(prefix="/api")


@router.get("/settings/default-terms")
def read_default_terms(engine: EngineDep) -> Terms:
    with engine.connect() as conn:
        return get_default_terms(conn)


@router.put("/settings/default-terms")
def update_default_terms(terms: Terms, engine: EngineDep) -> Terms:
    with engine.begin() as conn:
        set_default_terms(conn, terms)
        return get_default_terms(conn)


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
    daily_run = DailyRun(engine, today, jobs=[backup.start_if_due])

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

    app = FastAPI(title="Mortgage Management", lifespan=lifespan)
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

    app.include_router(router)
    app.include_router(customers.router)
    app.include_router(mortgages.router)
    app.include_router(payments.router)
    app.include_router(closing.router)
    app.include_router(photos.router)
    app.include_router(collateral.router)
    app.include_router(call_list.router)
    app.include_router(backups.router)
    app.include_router(audit.router)
    app.include_router(term_changes.router)
    app.include_router(projections.router)
    return app


app = create_app(
    database_url_from_env(),
    backup_dir=backup_dir_from_env(),
    backup_password=backup_password_from_env(),
)
