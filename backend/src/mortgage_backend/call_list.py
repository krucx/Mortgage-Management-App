"""The Call List and Call Notes (see GLOSSARY.md), calculated whenever it is asked for."""

from collections.abc import Mapping
from datetime import date, datetime
from typing import Literal

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import insert, select
from sqlalchemy.engine import Connection

from mortgage_backend.clock import TodayDep
from mortgage_backend.collateral import collateral_of, gold_rates
from mortgage_backend.customers import PersonSummary
from mortgage_backend.db import (
    EngineDep,
    call_note_table,
    customer_table,
    exists,
    mortgage_table,
)
from mortgage_backend.ledger import months_unpaid
from mortgage_backend.mortgages import select_with_customer
from mortgage_backend.paging import PAGE_SIZE, PageNumber, page_of
from mortgage_backend.replay import MortgageReplay, MortgageStatus, replays
from mortgage_backend.settings import ConfigGroup

Reason = Literal["months_unpaid", "loan_to_value", "accrues_today"]


class CallListSettings(BaseModel):
    months_unpaid: int = Field(default=3, ge=1)  # list at this many Months Unpaid
    loan_to_value_pct: int = Field(default=85, gt=0)  # list above this Loan-to-Value


class CallNoteIn(BaseModel):
    note: str = ""


class CallNote(BaseModel):
    id: int
    called_on: date
    note: str
    created_at: datetime


class CallListRow(BaseModel):
    mortgage_id: int
    mortgage_name: str
    reasons: list[Reason]
    months_unpaid: int
    loan_to_value: float | None  # None without a Collateral Value
    outstanding: int  # paise
    called: CallNote | None  # the latest Call Note made today


class CallListGroup(BaseModel):
    """One Customer's listed Mortgages."""

    customer: PersonSummary
    phone_1: str
    phone_2: str | None
    rows: list[CallListRow]


class CallListPage(BaseModel):
    """A page of the Call List: whole Customer groups, never one split across pages."""

    items: list[CallListGroup]
    total: int  # Customers listed
    mortgages: int  # Mortgages listed, across every page (as on the Dashboard)
    page: int
    page_size: int


CALL_LIST_SETTINGS = ConfigGroup.prefixed("call_list_", CallListSettings)


def _todays_notes(conn: Connection, today: date) -> dict[int, CallNote]:
    """The latest Call Note made today for each Mortgage."""
    notes = conn.execute(
        select(call_note_table)
        .where(call_note_table.c.called_on == today)
        .order_by(call_note_table.c.id)
    ).mappings()
    return {note["mortgage_id"]: CallNote.model_validate(note) for note in notes}


def call_list(
    conn: Connection,
    today: date,
    replayed: Mapping[int, MortgageReplay] | None = None,
) -> list[CallListGroup]:
    """Today's Call List, from `replayed` (covering every Active Mortgage) when the
    caller has replayed them already."""
    settings = CALL_LIST_SETTINGS.get(conn)
    rows = (
        conn.execute(
            select_with_customer()
            .add_columns(customer_table.c.phone_1, customer_table.c.phone_2)
            .where(mortgage_table.c.status == MortgageStatus.ACTIVE)
        )
        .mappings()
        .all()
    )
    if replayed is None:
        replayed = replays(conn, rows)
    rates = gold_rates(conn)
    called = _todays_notes(conn, today)

    listed = []
    for row in rows:
        ledger = replayed[row["id"]].ledger(today)
        outstanding = replayed[row["id"]].outstanding(today).total
        months = months_unpaid(ledger)
        collateral = collateral_of(row, rates, outstanding)
        loan_to_value = collateral.loan_to_value if collateral else None
        reasons: list[Reason] = []
        if months >= settings.months_unpaid:
            reasons.append("months_unpaid")
        if (
            loan_to_value is not None
            and loan_to_value * 100 > settings.loan_to_value_pct
        ):
            reasons.append("loan_to_value")
        if any(step.event == "interest" and step.on == today for step in ledger):
            reasons.append("accrues_today")
        if reasons:
            listed.append(
                (
                    row,
                    CallListRow(
                        mortgage_id=row["id"],
                        mortgage_name=row["name"],
                        reasons=reasons,
                        months_unpaid=months,
                        loan_to_value=loan_to_value,
                        outstanding=outstanding,
                        called=called.get(row["id"]),
                    ),
                )
            )

    def urgency(item: CallListRow) -> tuple[bool, int, float]:
        # Not yet called first, then the most Months Unpaid, then the highest Loan-to-Value.
        return (
            item.called is not None,
            -item.months_unpaid,
            -(item.loan_to_value or 0),
        )

    listed.sort(key=lambda pair: urgency(pair[1]))
    groups: dict[int, CallListGroup] = {}  # in order of each Customer's most urgent row
    for row, item in listed:
        group = groups.setdefault(
            row["customer_id"],
            CallListGroup(
                customer=PersonSummary(
                    kind="customer", id=row["customer_id"], name=row["customer_name"]
                ),
                phone_1=row["phone_1"],
                phone_2=row["phone_2"],
                rows=[],
            ),
        )
        group.rows.append(item)
    return list(groups.values())


router = APIRouter(prefix="/api")


@router.get("/call-list")
def read_call_list(
    engine: EngineDep, today: TodayDep, page: PageNumber = 1
) -> CallListPage:
    with engine.connect() as conn:
        groups = call_list(conn, today)
    return CallListPage(
        items=page_of(groups, page),
        total=len(groups),
        mortgages=sum(len(group.rows) for group in groups),
        page=page,
        page_size=PAGE_SIZE,
    )


@router.get("/settings/call-list")
def read_call_list_settings(engine: EngineDep) -> CallListSettings:
    with engine.connect() as conn:
        return CALL_LIST_SETTINGS.get(conn)


@router.put("/settings/call-list")
def update_call_list_settings(
    settings: CallListSettings, engine: EngineDep, today: TodayDep
) -> CallListSettings:
    with engine.begin() as conn:
        CALL_LIST_SETTINGS.set(conn, settings, today)
        return CALL_LIST_SETTINGS.get(conn)


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
