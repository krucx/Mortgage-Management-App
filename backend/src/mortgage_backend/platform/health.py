"""`GET /api/health`: whether the app's own subsystems work, for the container health
check and the QA stack's wait loop. It reads only the schema version, never a Customer
or Mortgage, so it answers the same on an empty book as on a full one."""

from typing import Literal

from alembic.runtime.migration import MigrationContext
from fastapi import APIRouter, Request, Response, status
from pydantic import BaseModel
from sqlalchemy import text

from mortgage_backend.platform.db import EngineDep, schema_head

router = APIRouter()


class DatabaseHealth(BaseModel):
    connected: bool
    error: str | None = None  # why it could not be reached


class MigrationsHealth(BaseModel):
    current: str | None  # the revision the database is at
    head: str | None  # the newest revision this version knows
    up_to_date: bool


class BackupsHealth(BaseModel):
    enabled: bool  # False when no backup folder is configured
    running: bool


class Health(BaseModel):
    status: Literal["ok", "unavailable"]
    database: DatabaseHealth
    migrations: MigrationsHealth | None  # unknown while the database is unreachable
    backups: BackupsHealth


@router.get("/health", responses={503: {"model": Health}})
def read_health(request: Request, engine: EngineDep, response: Response) -> Health:
    backups = request.app.state.backups
    backups_health = BackupsHealth(
        enabled=backups.backup_dir is not None, running=backups.running
    )
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
            current = MigrationContext.configure(conn).get_current_revision()
    except Exception as error:
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
        return Health(
            status="unavailable",
            database=DatabaseHealth(
                connected=False, error=f"{type(error).__name__}: {error}"
            ),
            migrations=None,
            backups=backups_health,
        )
    head = schema_head()
    up_to_date = current == head
    if not up_to_date:
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
    return Health(
        status="ok" if up_to_date else "unavailable",
        database=DatabaseHealth(connected=True),
        migrations=MigrationsHealth(current=current, head=head, up_to_date=up_to_date),
        backups=backups_health,
    )
