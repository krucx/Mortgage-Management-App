"""FastAPI app. Run with: uvicorn mortgage_backend.main:app"""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import APIRouter, FastAPI, Request
from sqlalchemy import create_engine
from sqlalchemy.engine import Engine

from mortgage_backend.db import database_url_from_env, migrate
from mortgage_backend.default_terms import DefaultTerms, get_default_terms, set_default_terms

router = APIRouter(prefix="/api")


def _engine(request: Request) -> Engine:
    engine: Engine = request.app.state.engine
    return engine


@router.get("/settings/default-terms")
def read_default_terms(request: Request) -> DefaultTerms:
    with _engine(request).connect() as conn:
        return get_default_terms(conn)


@router.put("/settings/default-terms")
def update_default_terms(terms: DefaultTerms, request: Request) -> DefaultTerms:
    with _engine(request).begin() as conn:
        set_default_terms(conn, terms)
        return get_default_terms(conn)


def create_app(database_url: str) -> FastAPI:
    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        migrate(database_url)  # every start brings the schema up to date
        yield

    app = FastAPI(title="Mortgage Management", lifespan=lifespan)
    app.state.engine = create_engine(database_url)
    app.include_router(router)
    return app


app = create_app(database_url_from_env())
