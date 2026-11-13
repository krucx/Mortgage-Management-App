"""The Lender's settings for messages to Customers: the Receipt and Reminder templates,
how many days ahead Reminders are queued, and whether they need approving first."""

from datetime import date

from fastapi import APIRouter
from pydantic import BaseModel, Field
from sqlalchemy.engine import Connection

from mortgage_backend.follow_up.messages import (
    RECEIPT_PLACEHOLDERS,
    REMINDER_PLACEHOLDERS,
    unknown_placeholders,
)
from mortgage_backend.platform.clock import TodayDep
from mortgage_backend.platform.db import EngineDep
from mortgage_backend.platform.errors import unprocessable
from mortgage_backend.platform.settings import ConfigGroup

RECEIPT_TEMPLATE = (
    "*Payment received* ✅\n"
    "\n"
    "Namaste {customer_name},\n"
    "We have received *{amount}* by {method} on {date}{grace}. Thank you!\n"
    "\n"
    "{mortgages}\n"
    "\n"
    "Total still owed: *{total_owed}*"
)

REMINDER_TEMPLATE = (
    "*Interest reminder* 🔔\n"
    "\n"
    "Namaste {customer_name},\n"
    "On *{date}*, interest of *{interest}* will be added.\n"
    "\n"
    "{mortgages}\n"
    "\n"
    "Total owed after that: *{total_owed}*\n"
    "Please get in touch with any questions. 🙏"
)


class MessageSettings(BaseModel):
    receipt_template: str = Field(default=RECEIPT_TEMPLATE, min_length=1)
    reminder_template: str = Field(default=REMINDER_TEMPLATE, min_length=1)
    reminder_days_before: int = Field(default=2, ge=1, le=28)
    # Reminders wait for the Lender's approval before they can be sent
    reminder_approve_first: bool = False


def _sync_reminders(conn: Connection, today: date) -> None:
    """Saving these syncs the Reminders to them at once."""
    # Imported here: the Reminder queue reads these settings itself.
    from mortgage_backend.follow_up import reminders

    reminders.sync(conn, today)


MESSAGE_SETTINGS = ConfigGroup.prefixed(
    "message_", MessageSettings, after_set=[_sync_reminders]
)


class MessagePlaceholders(BaseModel):
    """The placeholders each template may use."""

    receipt: list[str]
    reminder: list[str]


PLACEHOLDERS = MessagePlaceholders(
    receipt=list(RECEIPT_PLACEHOLDERS), reminder=list(REMINDER_PLACEHOLDERS)
)


def template_refusal(settings: MessageSettings) -> str | None:
    """Why `settings` can't be saved: a template using a placeholder it can't fill
    (it would reach the Customer as written)."""
    for name, template, allowed in (
        ("Receipt", settings.receipt_template, RECEIPT_PLACEHOLDERS),
        ("Reminder", settings.reminder_template, REMINDER_PLACEHOLDERS),
    ):
        if unknown := unknown_placeholders(template, allowed):
            usable = " ".join("{" + placeholder + "}" for placeholder in allowed)
            return (
                f"The {name} template can't fill {', '.join(unknown)}. "
                f"It can use: {usable}"
            )
    return None


router = APIRouter(prefix="/api")


@router.get("/settings/messages")
def read_message_settings(engine: EngineDep) -> MessageSettings:
    with engine.connect() as conn:
        return MESSAGE_SETTINGS.get(conn)


@router.put("/settings/messages")
def update_message_settings(
    settings: MessageSettings, engine: EngineDep, today: TodayDep
) -> MessageSettings:
    if reason := template_refusal(settings):
        raise unprocessable(reason)
    with engine.begin() as conn:
        MESSAGE_SETTINGS.set(conn, settings, today)
        return MESSAGE_SETTINGS.get(conn)


@router.get("/settings/messages/placeholders")
def read_message_placeholders() -> MessagePlaceholders:
    return PLACEHOLDERS
