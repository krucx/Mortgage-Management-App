"""`GET /api/health`: whether the app's own subsystems work, for the container health
check and the QA stack's wait loop. It reads only the schema version, never a Customer
or Mortgage, so it answers the same on an empty book as on a full one."""

from typing import Any

from alembic.config import Config
from alembic.runtime.migration import MigrationContext
from alembic.script import ScriptDirectory
from fastapi import APIRouter, Request, Response, status
from sqlalchemy import text

from mortgage_backend.platform.db import MIGRATIONS_DIR, EngineDep

router = APIRouter()


def _schema_head() -> str | None:
    config = Config()
    config.set_main_option("script_location", str(MIGRATIONS_DIR))
    return ScriptDirectory.from_config(config).get_current_head()


@router.get("/health")
def read_health(
    request: Request, engine: EngineDep, response: Response
) -> dict[str, Any]:
    backups = request.app.state.backups
    report: dict[str, Any] = {
        "status": "ok",
        "database": {"connected": True},
        "migrations": None,
        "backups": {
            "enabled": backups.backup_dir is not None,
            "running": backups.running,
        },
    }
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
            current = MigrationContext.configure(conn).get_current_revision()
    except Exception as error:
        report["database"] = {
            "connected": False,
            "error": f"{type(error).__name__}: {error}",
        }
        report["status"] = "unavailable"
    else:
        head = _schema_head()
        report["migrations"] = {
            "current": current,
            "head": head,
            "up_to_date": current == head,
        }
        if current != head:
            report["status"] = "unavailable"
    if report["status"] != "ok":
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
    return report
