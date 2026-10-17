"""The Lender's settings for messages to Customers: the Receipt and Notice templates,
how many days ahead Notices are queued, and whether they need approving first."""

from pydantic import BaseModel, Field
from sqlalchemy.engine import Connection

from mortgage_backend.db import get_config, set_config

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


_CONFIG_KEY_BY_FIELD = {
    field: f"message_{field}" for field in MessageSettings.model_fields
}


def get_message_settings(conn: Connection) -> MessageSettings:
    stored = get_config(conn, _CONFIG_KEY_BY_FIELD.values())
    return MessageSettings.model_validate(
        {
            field: stored[key]
            for field, key in _CONFIG_KEY_BY_FIELD.items()
            if key in stored
        }
    )


def set_message_settings(conn: Connection, settings: MessageSettings) -> None:
    for field, key in _CONFIG_KEY_BY_FIELD.items():
        value = getattr(settings, field)
        set_config(
            conn, key, str(value).lower() if isinstance(value, bool) else str(value)
        )
