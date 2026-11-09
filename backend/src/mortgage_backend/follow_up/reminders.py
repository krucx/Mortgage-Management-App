"""Reminders (see Documentation/GLOSSARY.md): the Reminder queue.

Every Reminder status rule lives here, behind two calls, and one rule, `is_eligible`,
decides which of a Customer's Mortgages a Reminder covers (ADR 0017): `sync` queues and
prunes by it, and the Reminders it has not yet sent or skipped are read by it too. `sync`
makes the unsent Reminders what they should be today under the current settings: one per
Customer per Accrual Date coming up within `reminder_days_before` days, none further
ahead, each awaiting approval or queued: held for approval while "approve first" is on
and the Lender has not approved it, queued otherwise. The daily run, reading the
Reminders or the Dashboard, and saving message settings all sync. `act` approves, skips
or sends one Reminder. Until it is sent or skipped, a Reminder is only that Customer
and date: which of their Active Mortgages accrue then, the amounts and the wording are
worked out whenever it is read (ADR 0001), so a later Payment, Mortgage or template edit
shows. Sending or skipping keeps the message as it was then, for the log. The Lender
sends by click-to-send WhatsApp (ADR 0002), which marks the Reminder sent.
"""

from collections import defaultdict
from collections.abc import Callable, Mapping, Sequence
from datetime import date, datetime, timedelta
from enum import StrEnum
from typing import Any, Literal

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import delete, false, insert, not_, select, update
from sqlalchemy.engine import Connection, RowMapping

from mortgage_backend.follow_up.message_settings import MESSAGE_SETTINGS
from mortgage_backend.follow_up.messages import (
    ReminderLine,
    ReminderMessage,
    descriptions,
    reminder_text,
)
from mortgage_backend.lending.ledger import accrual_date, is_accrual_date
from mortgage_backend.lending.replay import (
    MortgageReplay,
    MortgageStatus,
    active_replays,
    replays,
)
from mortgage_backend.payments.payments import MortgageLink
from mortgage_backend.people.customers import PersonSummary, phones_of
from mortgage_backend.platform.clock import NowDep, TodayDep
from mortgage_backend.platform.db import (
    EngineDep,
    customer_table,
    mortgage_table,
    reminder_mortgage_table,
    reminder_table,
)
from mortgage_backend.platform.paging import Page, PageNumber, rows_page


class ReminderStatus(StrEnum):
    AWAITING_APPROVAL = "awaiting_approval"
    QUEUED = "queued"
    SENT = "sent"
    SKIPPED = "skipped"


_UNSENT = {ReminderStatus.AWAITING_APPROVAL, ReminderStatus.QUEUED}


class Reminder(BaseModel):
    id: int
    customer: PersonSummary
    phones: list[str]  # the Customer's numbers, primary first
    accrues_on: date
    created_on: date
    status: ReminderStatus
    # As it stands now, or as it was sent or skipped; empty if no Active Mortgage of
    # the Customer accrues that day any more, or each that does is Dormant
    message: str
    mortgages: list[MortgageLink]
    sent_at: datetime | None


def _coming_accrual_dates(start: date, after: date, until: date) -> list[date]:
    """A Mortgage's Accrual Dates after `after`, up to and including `until`."""
    n = max(1, (after.year - start.year) * 12 + after.month - start.month)
    found = []
    while (on := accrual_date(start, n)) <= until:
        if on > after:
            found.append(on)
        n += 1
    return found


def is_eligible(mortgage: MortgageReplay, on: date) -> bool:
    """Whether `mortgage` is one a Reminder for `on` covers (ADR 0017): Active, an
    Accrual Date for it, and not Dormant then (ADR 0012). The one rule behind both what
    sync queues and prunes, and what an unsent Reminder currently has to say."""
    return (
        mortgage.row["status"] == MortgageStatus.ACTIVE
        and is_accrual_date(mortgage.row["start_date"], on)
        and not mortgage.dormant(on)
    )


def sync(
    conn: Connection,
    today: date,
    replayed: Mapping[int, MortgageReplay] | None = None,
) -> None:
    """Make the unsent Reminders what they should be today under the current settings.

    A Reminder for each Customer with Active Mortgages accruing in the coming
    `reminder_days_before` days and none yet; days the app was off are made up this way,
    but never for an Accrual Date already past. Unsent Reminders further ahead (queued
    before `reminder_days_before` was lowered) are withdrawn: until sent or skipped a
    Reminder is only its Customer and date, so it is queued again in time. Dormant
    Mortgages, owing nothing, get no Reminder (ADR 0012); they are worked out from
    `replayed` (covering every Active Mortgage) when the caller has replayed them.
    Every unsent Reminder then awaits approval if "approve first" is on and the Lender
    has not approved it, and is queued otherwise; while it is off, approvals are forgotten, so turning it
    on again holds every unsent Reminder. Syncing twice changes nothing."""
    settings = MESSAGE_SETTINGS.get(conn)
    until = today + timedelta(days=settings.reminder_days_before)
    conn.execute(
        delete(reminder_table).where(
            reminder_table.c.status.in_(_UNSENT), reminder_table.c.accrues_on > until
        )
    )
    coming = [
        (row, _coming_accrual_dates(row["start_date"], today, until))
        for row in conn.execute(
            select(mortgage_table).where(
                mortgage_table.c.status == MortgageStatus.ACTIVE
            )
        ).mappings()
    ]
    if replayed is None:
        replayed = replays(conn, [row for row, dates in coming if dates])
    accruing = {
        (row["customer_id"], on)
        for row, dates in coming
        for on in dates
        if is_eligible(replayed[row["id"]], on)
    }
    # Unsent Reminders are only actionable while at least one Mortgage remains
    # Active and accrues on their date. A future reopen can queue a fresh one.
    unsent_rows = conn.execute(
        select(reminder_table).where(reminder_table.c.status.in_(_UNSENT))
    ).mappings().all()
    still_eligible = _accruing(conn, unsent_rows, replayed)
    ineligible = [
        row["id"]
        for row in unsent_rows
        if not still_eligible[row["id"]]
    ]
    if ineligible:
        conn.execute(delete(reminder_table).where(reminder_table.c.id.in_(ineligible)))
    already = {
        (row.customer_id, row.accrues_on)
        for row in conn.execute(
            select(reminder_table.c.customer_id, reminder_table.c.accrues_on).where(
                reminder_table.c.accrues_on > today
            )
        )
    }
    for customer_id, on in sorted(accruing - already, key=lambda due: due[1]):
        conn.execute(
            insert(reminder_table).values(
                customer_id=customer_id,
                accrues_on=on,
                created_on=today,
                status=ReminderStatus.QUEUED,
            )
        )
    unsent = reminder_table.c.status.in_(_UNSENT)
    if settings.reminder_approve_first:
        held = not_(reminder_table.c.approved)
    else:
        held = false()
        conn.execute(update(reminder_table).where(unsent).values(approved=False))
    conn.execute(
        update(reminder_table)
        .where(unsent, held)
        .values(status=ReminderStatus.AWAITING_APPROVAL)
    )
    conn.execute(
        update(reminder_table)
        .where(unsent, not_(held))
        .values(status=ReminderStatus.QUEUED)
    )


def _reminder_line(mortgage: MortgageReplay, description: str, on: date) -> ReminderLine:
    """The month's interest `mortgage` will be charged on `on`, and its Outstanding
    then, with no further Payments."""
    [then] = mortgage.projection([on]).snapshots
    return ReminderLine(
        description=description,
        interest=then.interest_charged,
        owed_after=then.outstanding,
    )


def _accruing(
    conn: Connection,
    unsent: Sequence[RowMapping],
    replayed: Mapping[int, MortgageReplay] | None = None,
) -> dict[int, list[MortgageReplay]]:
    """Each unsent Reminder's Mortgages, by Reminder id, `is_eligible` decides which: its
    Customer's Active ones accruing that day and not Dormant then, by name; loaded in
    one query, and replayed unless `replayed` has them already."""
    mortgages = (
        conn.execute(
            select(mortgage_table)
            .where(
                mortgage_table.c.customer_id.in_(
                    [row["customer_id"] for row in unsent]
                ),
                mortgage_table.c.status == MortgageStatus.ACTIVE,
            )
            .order_by(mortgage_table.c.name)
        )
        .mappings()
        .all()
    )
    missing = [m for m in mortgages if replayed is None or m["id"] not in replayed]
    if missing:
        replayed = {**(replayed or {}), **replays(conn, missing)}
    replayed = replayed or {}
    by_customer: dict[int, list[MortgageReplay]] = defaultdict(list)
    for mortgage in mortgages:
        by_customer[mortgage["customer_id"]].append(replayed[mortgage["id"]])
    return {
        row["id"]: [
            m for m in by_customer[row["customer_id"]] if is_eligible(m, row["accrues_on"])
        ]
        for row in unsent
    }


def unsent_counts(
    conn: Connection, replayed: Mapping[int, MortgageReplay] | None = None
) -> dict[ReminderStatus, int]:
    """Unsent Reminders that still have something to say, by status (one whose Mortgages
    no longer accrue that day, or are Dormant, has not); nothing is worded, and only
    what `replayed` lacks is replayed."""
    unsent = (
        conn.execute(select(reminder_table).where(reminder_table.c.status.in_(_UNSENT)))
        .mappings()
        .all()
    )
    by_status = dict.fromkeys(_UNSENT, 0)
    accruing = _accruing(conn, unsent, replayed)
    for row in unsent:
        if accruing[row["id"]]:
            by_status[row["status"]] += 1
    return by_status


def _message(
    row: RowMapping,
    mortgages: Sequence[MortgageReplay],
    template: str,
) -> str:
    """An unsent Reminder's message, worked out now; empty without Mortgages."""
    if not mortgages:
        return ""
    on = row["accrues_on"]
    described = descriptions([m.row for m in mortgages])
    return reminder_text(
        template,
        ReminderMessage(
            customer_name=row["name"],
            accrues_on=on,
            lines=[_reminder_line(m, described[m.row["id"]], on) for m in mortgages],
        ),
    )


def list_reminders(
    conn: Connection,
    status_filter: ReminderStatus | None = None,
    reminder_id: int | None = None,
    replayed: Mapping[int, MortgageReplay] | None = None,
) -> list[Reminder]:
    """Reminders by Accrual Date, then Customer; optionally one status, or one Reminder.
    Unsent ones are worded from `replayed` (covering every Active Mortgage) when the
    caller has replayed them already."""
    query = (
        select(
            reminder_table,
            customer_table.c.name,
            customer_table.c.phone_1,
            customer_table.c.phone_2,
        )
        .join(customer_table, customer_table.c.id == reminder_table.c.customer_id)
        .order_by(reminder_table.c.accrues_on, customer_table.c.name, reminder_table.c.id)
    )
    if status_filter is not None:
        query = query.where(reminder_table.c.status == status_filter)
    if reminder_id is not None:
        query = query.where(reminder_table.c.id == reminder_id)
    rows = conn.execute(query).mappings().all()
    template = MESSAGE_SETTINGS.get(conn).reminder_template
    kept: dict[int, list[MortgageLink]] = defaultdict(list)
    for link in conn.execute(
        select(
            reminder_mortgage_table.c.reminder_id,
            mortgage_table.c.id,
            mortgage_table.c.name,
        )
        .join(
            mortgage_table, mortgage_table.c.id == reminder_mortgage_table.c.mortgage_id
        )
        .where(reminder_mortgage_table.c.reminder_id.in_([row["id"] for row in rows]))
        .order_by(mortgage_table.c.name)
    ):
        kept[link.reminder_id].append(MortgageLink(id=link.id, name=link.name))
    accruing = _accruing(
        conn, [row for row in rows if row["status"] in _UNSENT], replayed
    )
    reminders = []
    for row in rows:
        if row["id"] in accruing:
            mortgages = accruing[row["id"]]
            message = _message(row, mortgages, template)
            links = [
                MortgageLink(id=m.row["id"], name=m.row["name"]) for m in mortgages
            ]
        else:
            message, links = row["message"], kept[row["id"]]
        reminders.append(
            Reminder(
                id=row["id"],
                customer=PersonSummary(
                    kind="customer", id=row["customer_id"], name=row["name"]
                ),
                phones=phones_of(row),
                accrues_on=row["accrues_on"],
                created_on=row["created_on"],
                status=row["status"],
                message=message,
                mortgages=links,
                sent_at=row["sent_at"],
            )
        )
    return reminders


# A column of the Reminders list to sort it by.
ReminderSort = Literal["customer", "accrues", "mortgages", "status"]

# The order the Reminders page shows the statuses in.
_STATUS_ORDER = [
    ReminderStatus.AWAITING_APPROVAL,
    ReminderStatus.QUEUED,
    ReminderStatus.SENT,
    ReminderStatus.SKIPPED,
]
_SORT_KEYS: dict[ReminderSort, Callable[[Reminder], Any]] = {
    "customer": lambda reminder: reminder.customer.name.casefold(),
    "accrues": lambda reminder: reminder.accrues_on,
    # By the first of its Mortgages, by name; none sorts first.
    "mortgages": lambda reminder: (
        reminder.mortgages[0].name.casefold() if reminder.mortgages else ""
    ),
    "status": lambda reminder: _STATUS_ORDER.index(reminder.status),
}


class ReminderAction(StrEnum):
    APPROVE = "approve"
    SKIP = "skip"
    SEND = "send"


# What each action needs the Reminder to be, and what it becomes.
_ACTIONS: dict[ReminderAction, tuple[set[ReminderStatus], ReminderStatus]] = {
    ReminderAction.APPROVE: ({ReminderStatus.AWAITING_APPROVAL}, ReminderStatus.QUEUED),
    ReminderAction.SKIP: (_UNSENT, ReminderStatus.SKIPPED),
    ReminderAction.SEND: ({ReminderStatus.QUEUED}, ReminderStatus.SENT),
}


class ReminderNotFound(LookupError):
    """No Reminder has that id."""


class ReminderRefused(Exception):
    """The Reminder can't be acted on as asked; the message is for the Lender."""


def act(
    conn: Connection, reminder_id: int, action: ReminderAction, now: datetime
) -> Reminder:
    """Approve, skip or send one Reminder, or refuse to."""
    found = list_reminders(conn, reminder_id=reminder_id)
    if not found:
        raise ReminderNotFound(reminder_id)
    reminder = found[0]
    if action in {ReminderAction.APPROVE, ReminderAction.SEND} and not reminder.mortgages:
        raise ReminderRefused(
            "None of their Mortgages accruing that day still owes anything: skip it"
        )
    allowed, becomes = _ACTIONS[action]
    if reminder.status not in allowed:
        raise ReminderRefused(
            f"This Reminder is already {reminder.status.value.replace('_', ' ')}"
        )
    values: dict[str, object] = {"status": becomes}
    if action == ReminderAction.APPROVE:
        values["approved"] = True
    if becomes not in _UNSENT:
        # Sent or skipped: keep it as it was, for the log.
        values["message"] = reminder.message
        if reminder.mortgages:
            conn.execute(
                insert(reminder_mortgage_table),
                [
                    {"reminder_id": reminder_id, "mortgage_id": m.id}
                    for m in reminder.mortgages
                ],
            )
    if becomes == ReminderStatus.SENT:
        values["sent_at"] = now
    conn.execute(
        update(reminder_table).where(reminder_table.c.id == reminder_id).values(**values)
    )
    return list_reminders(conn, reminder_id=reminder_id)[0]


router = APIRouter(prefix="/api")


@router.get("/reminders")
def read_reminders(
    engine: EngineDep,
    today: TodayDep,
    status: ReminderStatus | None = None,
    page: PageNumber = 1,
    sort: ReminderSort | None = None,
    descending: bool = False,
) -> Page[Reminder]:
    """Reminders by Accrual Date, then Customer (or by `sort`, reversed when
    `descending`), synced first: a Mortgage added today or a reopened Mortgage shows at
    once, not after the next daily run."""
    with engine.begin() as conn:
        replayed = active_replays(conn)
        sync(conn, today, replayed)
        reminders = list_reminders(conn, status, replayed=replayed)
    return rows_page(reminders, page, _SORT_KEYS, sort=sort, descending=descending)


def _answer(
    engine: EngineDep, reminder_id: int, action: ReminderAction, now: datetime
) -> Reminder:
    try:
        with engine.begin() as conn:
            return act(conn, reminder_id, action, now)
    except ReminderNotFound:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Reminder not found") from None
    except ReminderRefused as refused:
        raise HTTPException(status.HTTP_409_CONFLICT, str(refused)) from None


@router.post("/reminders/{reminder_id}/approve")
def approve_reminder(reminder_id: int, engine: EngineDep, now: NowDep) -> Reminder:
    return _answer(engine, reminder_id, ReminderAction.APPROVE, now)


@router.post("/reminders/{reminder_id}/skip")
def skip_reminder(reminder_id: int, engine: EngineDep, now: NowDep) -> Reminder:
    return _answer(engine, reminder_id, ReminderAction.SKIP, now)


@router.post("/reminders/{reminder_id}/sent")
def mark_reminder_sent(reminder_id: int, engine: EngineDep, now: NowDep) -> Reminder:
    """The Lender opened the prefilled WhatsApp chat (click-to-send counts that as sent)."""
    return _answer(engine, reminder_id, ReminderAction.SEND, now)
