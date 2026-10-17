"""Notices (see GLOSSARY.md).

One Notice is queued per Customer per Accrual Date coming up within
`notice_days_before` days: by the daily run, and whenever the Notices are listed. Until it is sent or skipped, a Notice is only that Customer
and date: which of their Active Mortgages accrue then, the amounts and the wording are
worked out whenever it is read (ADR 0001), so a later Payment, Mortgage or template edit
shows. Sending or skipping keeps the message as it was then, for the log. The Lender
sends by click-to-send WhatsApp (ADR 0002), which marks the Notice sent.
"""

from collections import defaultdict
from datetime import date, datetime, timedelta
from enum import StrEnum

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import insert, select, update
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
from mortgage_backend.message_settings import (
    MessageSettings,
    get_message_settings,
    set_message_settings,
)
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


def queue_notices(conn: Connection, today: date) -> None:
    """The daily-run job: a Notice for each Customer with Active Mortgages accruing in
    the coming `notice_days_before` days and none yet. Days the app was off are made up
    this way, but never for an Accrual Date already past."""
    settings = get_message_settings(conn)
    until = today + timedelta(days=settings.notice_days_before)
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
    status_now = (
        NoticeStatus.AWAITING_APPROVAL
        if settings.notice_approve_first
        else NoticeStatus.QUEUED
    )
    for customer_id, on in sorted(accruing - already, key=lambda due: due[1]):
        conn.execute(
            insert(notice_table).values(
                customer_id=customer_id,
                accrues_on=on,
                created_on=today,
                status=status_now,
            )
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


def _as_it_stands(
    conn: Connection, row: RowMapping, template: str
) -> tuple[list[RowMapping], str]:
    """An unsent Notice's Mortgages (the Customer's Active ones accruing that day) and
    its message, worked out now."""
    on = row["accrues_on"]
    mortgages = [
        m
        for m in conn.execute(
            select(mortgage_table)
            .where(
                mortgage_table.c.customer_id == row["customer_id"],
                mortgage_table.c.status == MortgageStatus.ACTIVE,
            )
            .order_by(mortgage_table.c.name)
        ).mappings()
        if is_accrual_date(m["start_date"], on)
    ]
    if not mortgages:
        return [], ""
    replayed = replays(conn, mortgages)
    described = descriptions(mortgages)
    message = notice_text(
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
    return mortgages, message


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
    template = get_message_settings(conn).notice_template
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
    notices = []
    for row in rows:
        if row["status"] in _UNSENT:
            mortgages, message = _as_it_stands(conn, row, template)
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


def _act(
    conn: Connection, notice_id: int, action: NoticeAction, now: datetime
) -> Notice:
    found = list_notices(conn, notice_id=notice_id)
    if not found:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Notice not found")
    notice = found[0]
    allowed, becomes = _ACTIONS[action]
    if notice.status not in allowed:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"This Notice is already {notice.status.value.replace('_', ' ')}",
        )
    if action == NoticeAction.SEND and not notice.mortgages:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "None of their Active Mortgages accrues that day any more: skip it",
        )
    values: dict[str, object] = {"status": becomes}
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


def mark_sent(conn: Connection, notice_id: int, now: datetime) -> Notice:
    return _act(conn, notice_id, NoticeAction.SEND, now)


def change_message_settings(conn: Connection, settings: MessageSettings) -> None:
    """Save the settings; Notices waiting for approval are queued once it is off."""
    set_message_settings(conn, settings)
    if not settings.notice_approve_first:
        conn.execute(
            update(notice_table)
            .where(notice_table.c.status == NoticeStatus.AWAITING_APPROVAL)
            .values(status=NoticeStatus.QUEUED)
        )


router = APIRouter(prefix="/api")


@router.get("/settings/messages")
def read_message_settings(engine: EngineDep) -> MessageSettings:
    with engine.connect() as conn:
        return get_message_settings(conn)


@router.put("/settings/messages")
def update_message_settings(
    settings: MessageSettings, engine: EngineDep
) -> MessageSettings:
    with engine.begin() as conn:
        change_message_settings(conn, settings)
        return get_message_settings(conn)


@router.get("/notices")
def read_notices(
    engine: EngineDep,
    today: TodayDep,
    status: NoticeStatus | None = None,
    page: PageNumber = 1,
) -> NoticePage:
    """Notices, after queueing any now due: a Mortgage added today, a longer
    `notice_days_before` or a reopened Mortgage shows at once, not after the next
    daily run. Queueing twice adds nothing."""
    with engine.begin() as conn:
        queue_notices(conn, today)
        notices = list_notices(conn, status)
    return NoticePage(
        items=page_of(notices, page),
        total=len(notices),
        page=page,
        page_size=PAGE_SIZE,
    )


@router.post("/notices/{notice_id}/approve")
def approve_notice(notice_id: int, engine: EngineDep, now: NowDep) -> Notice:
    with engine.begin() as conn:
        return _act(conn, notice_id, NoticeAction.APPROVE, now)


@router.post("/notices/{notice_id}/skip")
def skip_notice(notice_id: int, engine: EngineDep, now: NowDep) -> Notice:
    with engine.begin() as conn:
        return _act(conn, notice_id, NoticeAction.SKIP, now)


@router.post("/notices/{notice_id}/sent")
def mark_notice_sent(notice_id: int, engine: EngineDep, now: NowDep) -> Notice:
    """The Lender opened the prefilled WhatsApp chat (click-to-send counts that as sent)."""
    with engine.begin() as conn:
        return mark_sent(conn, notice_id, now)
