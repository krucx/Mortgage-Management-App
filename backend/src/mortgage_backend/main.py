"""FastAPI app. Run with: uvicorn mortgage_backend.main:app"""

from collections.abc import AsyncIterator, Callable
from contextlib import asynccontextmanager
from datetime import date

from fastapi import APIRouter, FastAPI

from mortgage_backend import customers, mortgages, photos
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


def create_app(database_url: str, today: Callable[[], date] = date.today) -> FastAPI:
    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        migrate(database_url)  # every start brings the schema up to date
        yield

    app = FastAPI(title="Mortgage Management", lifespan=lifespan)
    app.state.engine = make_engine(database_url)
    app.state.photos_dir = photos_dir(database_url)
    app.state.today = today
    app.include_router(router)
    app.include_router(customers.router)
    app.include_router(mortgages.router)
    app.include_router(photos.router)
    return app


app = create_app(database_url_from_env())
