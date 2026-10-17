"""The audit log: every create, edit, void and closure, with old and new values."""

from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass
from datetime import date, datetime
from typing import Any, Literal

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import and_, insert, or_, select
from sqlalchemy.engine import Connection

from mortgage_backend.db import (
    EngineDep,
    allocation_table,
    audit_entry_table,
    customer_table,
    exists,
    mortgage_table,
    payment_table,
)

Entity = Literal["customer", "mortgage", "payment"]
Action = Literal[
    "created",
    "edited",
    "deleted",
    "voided",
    "redeemed",
    "forfeited",
    "reopened",
    "photo_added",
    "photo_removed",
]


@dataclass(frozen=True)
class Change:
    field: str
    old: str | None
    new: str | None


def _text(value: object) -> str | None:
    if value is None:
        return None
    if isinstance(value, date):
        return value.isoformat()
    return str(value)


def changes(
    before: Mapping[Any, object], after: Mapping[Any, object], fields: Iterable[str]
) -> list[Change]:
    """The fields whose value differs, old and new as text."""
    found = []
    for field in fields:
        old, new = _text(before[field]), _text(after[field])
        if old != new:
            found.append(Change(field, old, new))
    return found


def created(values: Mapping[Any, object], fields: Iterable[str]) -> list[Change]:
    """The values something was created with, as changes from nothing."""
    return changes(dict.fromkeys(fields), values, fields)


def record(
    conn: Connection,
    at: datetime,
    entity: Entity,
    entity_id: int,
    action: Action,
    changed: Sequence[Change] = (),
    note: str | None = None,
) -> None:
    """Write an audit entry: one row per changed field, or one row if none."""
    rows = [
        {"field": c.field, "old_value": c.old, "new_value": c.new} for c in changed
    ] or [{"field": None, "old_value": None, "new_value": None}]
    conn.execute(
        insert(audit_entry_table),
        [
            {
                "at": at,
                "entity": entity,
                "entity_id": entity_id,
                "action": action,
                "note": note,
                **row,
            }
            for row in rows
        ],
    )


class AuditEntry(BaseModel):
    id: int
    at: datetime
    entity: Entity
    entity_id: int
    action: Action
    field: str | None
    old_value: str | None
    new_value: str | None
    note: str | None
    mortgage_name: str | None  # for a Mortgage's entries: which one (its current name)


def _entries(conn: Connection, *where: object) -> list[AuditEntry]:
    rows = conn.execute(
        select(audit_entry_table, mortgage_table.c.name.label("mortgage_name"))
        .outerjoin(
            mortgage_table,
            and_(
                audit_entry_table.c.entity == "mortgage",
                mortgage_table.c.id == audit_entry_table.c.entity_id,
            ),
        )
        .where(or_(*where))  # type: ignore[arg-type]
        .order_by(audit_entry_table.c.id.desc())
    ).mappings()
    return [AuditEntry.model_validate(row) for row in rows]


def _about(entity: Entity, ids: object) -> object:
    return and_(
        audit_entry_table.c.entity == entity,
        audit_entry_table.c.entity_id.in_(ids),  # type: ignore[arg-type]
    )


def mortgage_history(conn: Connection, mortgage_id: int) -> list[AuditEntry]:
    """A Mortgage's changes, and those of the Payments made to it, newest first."""
    payments = select(allocation_table.c.payment_id).where(
        allocation_table.c.mortgage_id == mortgage_id
    )
    return _entries(
        conn, _about("mortgage", [mortgage_id]), _about("payment", payments)
    )


def customer_history(conn: Connection, customer_id: int) -> list[AuditEntry]:
    """A Customer's changes, and those of their Mortgages and Payments, newest first."""
    mortgages = select(mortgage_table.c.id).where(
        mortgage_table.c.customer_id == customer_id
    )
    payments = select(payment_table.c.id).where(
        payment_table.c.customer_id == customer_id
    )
    return _entries(
        conn,
        _about("customer", [customer_id]),
        _about("mortgage", mortgages),
        _about("payment", payments),
    )


router = APIRouter(prefix="/api")


@router.get("/mortgages/{mortgage_id}/history")
def read_mortgage_history(mortgage_id: int, engine: EngineDep) -> list[AuditEntry]:
    with engine.connect() as conn:
        if not exists(conn, mortgage_table, mortgage_id):
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Mortgage not found")
        return mortgage_history(conn, mortgage_id)


@router.get("/customers/{customer_id}/history")
def read_customer_history(customer_id: int, engine: EngineDep) -> list[AuditEntry]:
    with engine.connect() as conn:
        if not exists(conn, customer_table, customer_id):
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Customer not found")
        return customer_history(conn, customer_id)
