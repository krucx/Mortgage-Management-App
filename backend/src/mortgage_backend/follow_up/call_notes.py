"""Call Notes: the Lender's record of phoning a Customer about a Mortgage."""

from datetime import date, datetime

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import insert, select
from sqlalchemy.engine import Connection

from mortgage_backend.platform.clock import TodayDep
from mortgage_backend.platform.db import (
    EngineDep,
    call_note_table,
    exists,
    mortgage_table,
)


class CallNoteIn(BaseModel):
    note: str = ""


class CallNote(BaseModel):
    id: int
    called_on: date
    note: str
    created_at: datetime


router = APIRouter(prefix="/api")


def _not_found_unless_exists(conn: Connection, mortgage_id: int) -> None:
    if not exists(conn, mortgage_table, mortgage_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Mortgage not found")


@router.post("/mortgages/{mortgage_id}/call-notes", status_code=status.HTTP_201_CREATED)
def add_call_note(
    mortgage_id: int, call_note: CallNoteIn, engine: EngineDep, today: TodayDep
) -> CallNote:
    """Mark a Mortgage as called today, with what was said."""
    with engine.begin() as conn:
        _not_found_unless_exists(conn, mortgage_id)
        note = (
            conn.execute(
                insert(call_note_table)
                .values(
                    mortgage_id=mortgage_id,
                    called_on=today,
                    note=call_note.note.strip(),
                )
                .returning(call_note_table)
            )
            .mappings()
            .one()
        )
        return CallNote.model_validate(note)


@router.get("/mortgages/{mortgage_id}/call-notes")
def list_call_notes(mortgage_id: int, engine: EngineDep) -> list[CallNote]:
    """A Mortgage's Call Notes, newest first."""
    with engine.connect() as conn:
        _not_found_unless_exists(conn, mortgage_id)
        notes = conn.execute(
            select(call_note_table)
            .where(call_note_table.c.mortgage_id == mortgage_id)
            .order_by(call_note_table.c.id.desc())
        ).mappings()
        return [CallNote.model_validate(note) for note in notes]
