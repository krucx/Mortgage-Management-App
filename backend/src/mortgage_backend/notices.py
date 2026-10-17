"""Notices (see GLOSSARY.md): the Notice queue.

Every Notice status rule lives here, behind two calls. `sync` makes the unsent Notices
what they should be today under the current settings: one per Customer per Accrual Date
coming up within `notice_days_before` days, none further ahead, each awaiting approval or
queued: held for approval while "approve first" is on and the Lender has not approved
it, queued otherwise. The daily run, reading the
Notices or the Dashboard, and saving message settings all sync. `act` approves, skips
or sends one Notice. Until it is sent or skipped, a Notice is only that Customer
and date: which of their Active Mortgages accrue then, the amounts and the wording are
worked out whenever it is read (ADR 0001), so a later Payment, Mortgage or template edit
shows. Sending or skipping keeps the message as it was then, for the log. The Lender
sends by click-to-send WhatsApp (ADR 0002), which marks the Notice sent.
"""

from collections import defaultdict
from collections.abc import Mapping, Sequence
from datetime import date, datetime, timedelta
from enum import StrEnum

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import delete, false, insert, not_, select, update
from sqlalchemy.engine import Connection, RowMapping

from mortgage_backend.clock import NowDep, TodayDep
from mortgage_backend.customers import PersonSummary, phones_of
from mortgage_backend.db import (
    EngineDep,
    customer_table,
    mortgage_table,
    notice_mortgage_table,
    notice_table,
)
from mortgage_backend.ledger import accrual_date, is_accrual_date
from mortgage_backend.message_settings import MESSAGE_SETTINGS, MessageSettings
from mortgage_backend.messages import (
    NoticeLine,
    NoticeMessage,
    descriptions,
    notice_text,
)
from mortgage_backend.paging import PAGE_SIZE, PageNumber, page_of
from mortgage_backend.payments import MortgageLink
from mortgage_backend.replay import MortgageReplay, MortgageStatus, replays


class NoticeStatus(StrEnum):
    AWAITING_APPROVAL = "awaiting_approval"
    QUEUED = "queued"
    SENT = "sent"
    SKIPPED = "skipped"


_UNSENT = {NoticeStatus.AWAITING_APPROVAL, NoticeStatus.QUEUED}


class Notice(BaseModel):
    id: int
    customer: PersonSummary
    phones: list[str]  # the Customer's numbers, primary first
    accrues_on: date
    created_on: date
    status: NoticeStatus
    # As it stands now, or as it was sent or skipped; empty if no Active Mortgage of
    # the Customer accrues that day any more
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


def sync(conn: Connection, today: date) -> None:
    """Make the unsent Notices what they should be today under the current settings.

    A Notice for each Customer with Active Mortgages accruing in the coming
    `notice_days_before` days and none yet; days the app was off are made up this way,
    but never for an Accrual Date already past. Unsent Notices further ahead (queued
    before `notice_days_before` was lowered) are withdrawn: until sent or skipped a
    Notice is only its Customer and date, so it is queued again in time. Every unsent
    Notice then awaits approval if "approve first" is on and the Lender has not approved
    it, and is queued otherwise; while it is off, approvals are forgotten, so turning it
    on again holds every unsent Notice. Syncing twice changes nothing."""
    settings = MESSAGE_SETTINGS.get(conn)
    until = today + timedelta(days=settings.notice_days_before)
    conn.execute(
        delete(notice_table).where(
            notice_table.c.status.in_(_UNSENT), notice_table.c.accrues_on > until
        )
    )
    accruing = {
        (row.customer_id, on)
        for row in conn.execute(
            select(mortgage_table.c.customer_id, mortgage_table.c.start_date).where(
                mortgage_table.c.status == MortgageStatus.ACTIVE
            )
        )
        for on in _coming_accrual_dates(row.start_date, today, until)
    }
    already = {
        (row.customer_id, row.accrues_on)
        for row in conn.execute(
            select(notice_table.c.customer_id, notice_table.c.accrues_on).where(
                notice_table.c.accrues_on > today
            )
        )
    }
    for customer_id, on in sorted(accruing - already, key=lambda due: due[1]):
        conn.execute(
            insert(notice_table).values(
                customer_id=customer_id,
                accrues_on=on,
                created_on=today,
                status=NoticeStatus.QUEUED,
            )
        )
    unsent = notice_table.c.status.in_(_UNSENT)
    if settings.notice_approve_first:
        held = not_(notice_table.c.approved)
    else:
        held = false()
        conn.execute(update(notice_table).where(unsent).values(approved=False))
    conn.execute(
        update(notice_table)
        .where(unsent, held)
        .values(status=NoticeStatus.AWAITING_APPROVAL)
    )
    conn.execute(
        update(notice_table)
        .where(unsent, not_(held))
        .values(status=NoticeStatus.QUEUED)
    )


def _notice_line(mortgage: MortgageReplay, description: str, on: date) -> NoticeLine:
    """The interest `mortgage` will be charged on `on`, with no further Payments."""
    before, after = mortgage.projection([on - timedelta(days=1), on]).snapshots
    owed_before = before.principal + before.unpaid_interest
    owed_after = after.principal + after.unpaid_interest
    return NoticeLine(
        description=description,
        interest=owed_after - owed_before,
        owed_after=owed_after,
    )


def _accruing(
    conn: Connection, unsent: Sequence[RowMapping]
) -> dict[int, list[RowMapping]]:
    """Each unsent Notice's Mortgages, by Notice id: its Customer's Active ones accruing
    that day, by name; loaded in one query."""
    by_customer: dict[int, list[RowMapping]] = defaultdict(list)
    for mortgage in conn.execute(
        select(mortgage_table)
        .where(
            mortgage_table.c.customer_id.in_([row["customer_id"] for row in unsent]),
            mortgage_table.c.status == MortgageStatus.ACTIVE,
        )
        .order_by(mortgage_table.c.name)
    ).mappings():
        by_customer[mortgage["customer_id"]].append(mortgage)
    return {
        row["id"]: [
            m
            for m in by_customer[row["customer_id"]]
            if is_accrual_date(m["start_date"], row["accrues_on"])
        ]
        for row in unsent
    }


def unsent_counts(conn: Connection) -> dict[NoticeStatus, int]:
    """Unsent Notices that still have something to say, by status (one whose Mortgages
    no longer accrue that day has not); nothing is replayed or worded."""
    unsent = (
        conn.execute(select(notice_table).where(notice_table.c.status.in_(_UNSENT)))
        .mappings()
        .all()
    )
    by_status = dict.fromkeys(_UNSENT, 0)
    accruing = _accruing(conn, unsent)
    for row in unsent:
        if accruing[row["id"]]:
            by_status[row["status"]] += 1
    return by_status


def _message(
    row: RowMapping,
    mortgages: Sequence[RowMapping],
    replayed: Mapping[int, MortgageReplay],
    template: str,
) -> str:
    """An unsent Notice's message, worked out now; empty without Mortgages."""
    if not mortgages:
        return ""
    on = row["accrues_on"]
    described = descriptions(mortgages)
    return notice_text(
        template,
        NoticeMessage(
            customer_name=row["name"],
            accrues_on=on,
            lines=[
                _notice_line(replayed[m["id"]], described[m["id"]], on)
                for m in mortgages
            ],
        ),
    )


def list_notices(
    conn: Connection,
    status_filter: NoticeStatus | None = None,
    notice_id: int | None = None,
) -> list[Notice]:
    """Notices by Accrual Date, then Customer; optionally one status, or one Notice."""
    query = (
        select(
            notice_table,
            customer_table.c.name,
            customer_table.c.phone_1,
            customer_table.c.phone_2,
        )
        .join(customer_table, customer_table.c.id == notice_table.c.customer_id)
        .order_by(notice_table.c.accrues_on, customer_table.c.name, notice_table.c.id)
    )
    if status_filter is not None:
        query = query.where(notice_table.c.status == status_filter)
    if notice_id is not None:
        query = query.where(notice_table.c.id == notice_id)
    rows = conn.execute(query).mappings().all()
    template = MESSAGE_SETTINGS.get(conn).notice_template
    kept: dict[int, list[MortgageLink]] = defaultdict(list)
    for link in conn.execute(
        select(
            notice_mortgage_table.c.notice_id,
            mortgage_table.c.id,
            mortgage_table.c.name,
        )
        .join(
            mortgage_table, mortgage_table.c.id == notice_mortgage_table.c.mortgage_id
        )
        .where(notice_mortgage_table.c.notice_id.in_([row["id"] for row in rows]))
        .order_by(mortgage_table.c.name)
    ):
        kept[link.notice_id].append(MortgageLink(id=link.id, name=link.name))
    accruing = _accruing(conn, [row for row in rows if row["status"] in _UNSENT])
    involved = {m["id"]: m for mortgages in accruing.values() for m in mortgages}
    replayed = replays(conn, list(involved.values()))
    notices = []
    for row in rows:
        if row["id"] in accruing:
            mortgages = accruing[row["id"]]
            message = _message(row, mortgages, replayed, template)
            links = [MortgageLink(id=m["id"], name=m["name"]) for m in mortgages]
        else:
            message, links = row["message"], kept[row["id"]]
        notices.append(
            Notice(
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
    return notices


class NoticePage(BaseModel):
    items: list[Notice]
    total: int
    page: int
    page_size: int


class NoticeAction(StrEnum):
    APPROVE = "approve"
    SKIP = "skip"
    SEND = "send"


# What each action needs the Notice to be, and what it becomes.
_ACTIONS: dict[NoticeAction, tuple[set[NoticeStatus], NoticeStatus]] = {
    NoticeAction.APPROVE: ({NoticeStatus.AWAITING_APPROVAL}, NoticeStatus.QUEUED),
    NoticeAction.SKIP: (_UNSENT, NoticeStatus.SKIPPED),
    NoticeAction.SEND: ({NoticeStatus.QUEUED}, NoticeStatus.SENT),
}


class NoticeNotFound(LookupError):
    """No Notice has that id."""


class NoticeRefused(Exception):
    """The Notice can't be acted on as asked; the message is for the Lender."""


def act(
    conn: Connection, notice_id: int, action: NoticeAction, now: datetime
) -> Notice:
    """Approve, skip or send one Notice, or refuse to."""
    found = list_notices(conn, notice_id=notice_id)
    if not found:
        raise NoticeNotFound(notice_id)
    notice = found[0]
    allowed, becomes = _ACTIONS[action]
    if notice.status not in allowed:
        raise NoticeRefused(
            f"This Notice is already {notice.status.value.replace('_', ' ')}"
        )
    if action == NoticeAction.SEND and not notice.mortgages:
        raise NoticeRefused(
            "None of their Active Mortgages accrues that day any more: skip it"
        )
    values: dict[str, object] = {"status": becomes}
    if action == NoticeAction.APPROVE:
        values["approved"] = True
    if becomes not in _UNSENT:
        # Sent or skipped: keep it as it was, for the log.
        values["message"] = notice.message
        if notice.mortgages:
            conn.execute(
                insert(notice_mortgage_table),
                [
                    {"notice_id": notice_id, "mortgage_id": m.id}
                    for m in notice.mortgages
                ],
            )
    if becomes == NoticeStatus.SENT:
        values["sent_at"] = now
    conn.execute(
        update(notice_table).where(notice_table.c.id == notice_id).values(**values)
    )
    return list_notices(conn, notice_id=notice_id)[0]



router = APIRouter(prefix="/api")


@router.get("/settings/messages")
def read_message_settings(engine: EngineDep) -> MessageSettings:
    with engine.connect() as conn:
        return MESSAGE_SETTINGS.get(conn)


@router.put("/settings/messages")
def update_message_settings(
    settings: MessageSettings, engine: EngineDep, today: TodayDep
) -> MessageSettings:
    with engine.begin() as conn:
        MESSAGE_SETTINGS.set(conn, settings, today)
        return MESSAGE_SETTINGS.get(conn)


@router.get("/notices")
def read_notices(
    engine: EngineDep,
    today: TodayDep,
    status: NoticeStatus | None = None,
    page: PageNumber = 1,
) -> NoticePage:
    """Notices, synced first: a Mortgage added today or a reopened Mortgage shows at
    once, not after the next daily run."""
    with engine.begin() as conn:
        sync(conn, today)
        notices = list_notices(conn, status)
    return NoticePage(
        items=page_of(notices, page),
        total=len(notices),
        page=page,
        page_size=PAGE_SIZE,
    )


def _answer(
    engine: EngineDep, notice_id: int, action: NoticeAction, now: datetime
) -> Notice:
    try:
        with engine.begin() as conn:
            return act(conn, notice_id, action, now)
    except NoticeNotFound:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Notice not found") from None
    except NoticeRefused as refused:
        raise HTTPException(status.HTTP_409_CONFLICT, str(refused)) from None


@router.post("/notices/{notice_id}/approve")
def approve_notice(notice_id: int, engine: EngineDep, now: NowDep) -> Notice:
    return _answer(engine, notice_id, NoticeAction.APPROVE, now)


@router.post("/notices/{notice_id}/skip")
def skip_notice(notice_id: int, engine: EngineDep, now: NowDep) -> Notice:
    return _answer(engine, notice_id, NoticeAction.SKIP, now)


@router.post("/notices/{notice_id}/sent")
def mark_notice_sent(notice_id: int, engine: EngineDep, now: NowDep) -> Notice:
    """The Lender opened the prefilled WhatsApp chat (click-to-send counts that as sent)."""
    return _answer(engine, notice_id, NoticeAction.SEND, now)
