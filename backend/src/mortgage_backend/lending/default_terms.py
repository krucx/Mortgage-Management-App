"""The default Terms copied into every new Mortgage (see Documentation/GLOSSARY.md)."""

from fastapi import APIRouter

from mortgage_backend.lending.terms import Terms
from mortgage_backend.platform.clock import TodayDep
from mortgage_backend.platform.db import EngineDep, write_transaction
from mortgage_backend.platform.settings import ConfigGroup

# Stored when the database is created (migration 0001), so never missing.
DEFAULT_TERMS = ConfigGroup.prefixed("default_", Terms)

router = APIRouter()


@router.get("/settings/default-terms")
def read_default_terms(engine: EngineDep) -> Terms:
    with engine.connect() as conn:
        return DEFAULT_TERMS.get(conn)


@router.put("/settings/default-terms")
def update_default_terms(terms: Terms, engine: EngineDep, today: TodayDep) -> Terms:
    with write_transaction(engine) as conn:
        DEFAULT_TERMS.set(conn, terms, today)
        return DEFAULT_TERMS.get(conn)
