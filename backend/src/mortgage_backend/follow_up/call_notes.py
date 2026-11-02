"""Call Notes: the Lender's record of phoning a Customer about a Mortgage.

One set of rules, whether a Call Note is added on its own or imported from a Call
Sheet: only on an Active Mortgage (a Dormant one is Active), never empty, dated
neither after today nor before the Mortgage started; an exact duplicate (same
Mortgage, date and note) is kept once.
"""

from datetime import date, datetime
from typing import Any

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import insert, select
from sqlalchemy.engine import Connection

from mortgage_backend.lending.replay import MortgageStatus
from mortgage_backend.platform.clock import TodayDep
from mortgage_backend.platform.db import EngineDep, call_note_table, mortgage_table
from mortgage_backend.platform.errors import unprocessable


class CallNoteIn(BaseModel):
    note: str = ""


class CallNote(BaseModel):
    id: int
    called_on: date
    note: str
    created_at: datetime


def left_out_because(
    mortgage: Any, called_on: date, note: str, today: date
) -> str | None:
    """Why a Call Note (its text already trimmed) can't be added to `mortgage` (a row
    with its status and start date), if it can't."""
    if not note:
        return "the Call Note is empty"
    if mortgage.status != MortgageStatus.ACTIVE:
        return f"it is {mortgage.status}"
    if called_on > today:
        return "Called on is after today"
    if called_on < mortgage.start_date:
        return "Called on is before the Mortgage started"
    return None


def record_call_note(
    conn: Connection, mortgage_id: int, note: str, today: date
) -> CallNote:
    """Mark a Mortgage as called today, with what was said (or refuse); the same note
    already added today is given back instead."""
    mortgage = _mortgage(conn, mortgage_id)
    note = note.strip()
    reason = left_out_because(mortgage, today, note, today)
    if reason is not None:
        raise unprocessable(f"{mortgage.name}: {reason}")
    same = conn.execute(
        select(call_note_table).where(
            call_note_table.c.mortgage_id == mortgage_id,
            call_note_table.c.called_on == today,
            call_note_table.c.note == note,
        )
    ).mappings().first()
    if same is None:
        same = (
            conn.execute(
                insert(call_note_table)
                .values(mortgage_id=mortgage_id, called_on=today, note=note)
                .returning(call_note_table)
            )
            .mappings()
            .one()
        )
    return CallNote.model_validate(same)


def _mortgage(conn: Connection, mortgage_id: int) -> Any:
    """The Mortgage's name, status and start date, or 404."""
    mortgage = conn.execute(
        select(
            mortgage_table.c.name, mortgage_table.c.status, mortgage_table.c.start_date
        ).where(mortgage_table.c.id == mortgage_id)
    ).one_or_none()
    if mortgage is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Mortgage not found")
    return mortgage


router = APIRouter(prefix="/api")


@router.post("/mortgages/{mortgage_id}/call-notes", status_code=status.HTTP_201_CREATED)
def add_call_note(
    mortgage_id: int, call_note: CallNoteIn, engine: EngineDep, today: TodayDep
) -> CallNote:
    """Mark a Mortgage as called today, with what was said."""
    with engine.begin() as conn:
        return record_call_note(conn, mortgage_id, call_note.note, today)


@router.get("/mortgages/{mortgage_id}/call-notes")
def list_call_notes(mortgage_id: int, engine: EngineDep) -> list[CallNote]:
    """A Mortgage's Call Notes, newest first."""
    with engine.connect() as conn:
        _mortgage(conn, mortgage_id)
        notes = conn.execute(
            select(call_note_table)
            .where(call_note_table.c.mortgage_id == mortgage_id)
            .order_by(call_note_table.c.id.desc())
        ).mappings()
        return [CallNote.model_validate(note) for note in notes]
