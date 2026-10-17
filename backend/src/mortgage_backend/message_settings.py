"""The Lender's settings for messages to Customers: the Receipt and Notice templates,
how many days ahead Notices are queued, and whether they need approving first."""

from datetime import date

from pydantic import BaseModel, Field
from sqlalchemy.engine import Connection

from mortgage_backend.settings import ConfigGroup

RECEIPT_TEMPLATE = (
    "*Payment received* ✅\n"
    "\n"
    "Namaste {customer_name},\n"
    "We have received *{amount}* by {method} on {date}. Thank you!\n"
    "\n"
    "{mortgages}\n"
    "\n"
    "Total still owed: *{total_owed}*"
)

NOTICE_TEMPLATE = (
    "*Interest notice* 🔔\n"
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
    notice_template: str = Field(default=NOTICE_TEMPLATE, min_length=1)
    notice_days_before: int = Field(default=2, ge=1, le=28)
    # Notices wait for the Lender's approval before they can be sent
    notice_approve_first: bool = False


def _sync_notices(conn: Connection, today: date) -> None:
    """Saving these syncs the Notices to them at once."""
    # Imported here: the Notice queue reads these settings itself.
    from mortgage_backend import notices

    notices.sync(conn, today)


MESSAGE_SETTINGS = ConfigGroup.prefixed(
    "message_", MessageSettings, after_set=[_sync_notices]
)
