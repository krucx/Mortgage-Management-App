"""WhatsApp messages to Customers: Receipts and Notices, from the Lender's templates.

WhatsApp has no tables, so each Mortgage becomes a small card inside a monospace block
(```), its amounts right-aligned so the columns line up on a phone. A Customer sees
each Mortgage's description, never its Mortgage Name.
"""

import re
import textwrap
from collections import Counter
from collections.abc import Sequence
from datetime import date

from pydantic import BaseModel
from sqlalchemy.engine import RowMapping

from mortgage_backend.platform.money import format_inr

CARD_WIDTH = 24  # characters: fits a phone's WhatsApp monospace line
RULE = "─"


class ReceiptLine(BaseModel):
    """What a Payment did to one Mortgage."""

    description: str  # of the Mortgage's jewellery, as the Customer knows it
    paid: int  # paise: the Allocation
    interest_paid: int
    principal_paid: int
    owed_after: int  # Outstanding just after the Payment


class ReceiptMessage(BaseModel):
    customer_name: str
    paid_on: date
    amount: int
    method: str  # as the Customer reads it, e.g. "Cash"
    reference: str | None = None
    lines: Sequence[ReceiptLine]

    @property
    def total_owed(self) -> int:
        """What the Mortgages it paid still owe, between them."""
        return sum(line.owed_after for line in self.lines)


class NoticeLine(BaseModel):
    """The interest one Mortgage is about to be charged."""

    description: str
    interest: int  # paise, added on the Accrual Date
    owed_after: int  # Outstanding once it is added


class NoticeMessage(BaseModel):
    customer_name: str
    accrues_on: date
    lines: list[NoticeLine]


Row = tuple[str, int]  # label, paise


def descriptions(mortgages: Sequence[RowMapping]) -> dict[int, str]:
    """How a Customer tells their Mortgages apart: the description, with the start date
    when two in the same message are described alike."""
    count = Counter(m["description"] for m in mortgages)
    return {
        m["id"]: m["description"]
        if count[m["description"]] == 1
        else f"{m['description']} (from {_date(m['start_date'])})"
        for m in mortgages
    }


def _card_block(cards: list[tuple[str, list[Row]]], totals: list[Row]) -> str:
    """A monospace block: a titled card per Mortgage, then totals if more than one."""
    rows = [row for _, card in cards for row in card] + totals
    width = max(
        CARD_WIDTH, *(len(label) + 1 + len(format_inr(paise)) for label, paise in rows)
    )

    def line(label: str, paise: int) -> str:
        amount = format_inr(paise)
        return label + amount.rjust(width - len(label))

    parts = [
        "\n".join([*textwrap.wrap(title, width), *(line(*row) for row in card)])
        for title, card in cards
    ]
    body = "\n\n".join(parts)
    if len(cards) > 1:
        body += "\n" + RULE * width + "\n" + "\n".join(line(*row) for row in totals)
    return f"```\n{body}\n```"


# The placeholders each template may use; saving a template using any other is refused.
RECEIPT_PLACEHOLDERS = (
    "customer_name",
    "amount",
    "method",
    "reference",
    "date",
    "mortgages",
    "total_owed",
)
NOTICE_PLACEHOLDERS = ("customer_name", "date", "interest", "mortgages", "total_owed")

_PLACEHOLDER = re.compile(r"\{(\w+)\}")
_BRACED = re.compile(r"\{[^{}]*\}?")  # a brace, up to the next brace or closing one


def unknown_placeholders(template: str, allowed: Sequence[str]) -> list[str]:
    """Each brace in `template` that is not exactly an `allowed` {placeholder}, as
    written (so `{name}`, `{ amount }`, or an unclosed `{date`), once each, in order;
    any of these would reach the Customer as typed."""
    usable = {"{" + name + "}" for name in allowed}
    found = dict.fromkeys(_BRACED.findall(template))
    return [written for written in found if written not in usable]


def fill(template: str, values: dict[str, str]) -> str:
    """The template with each {placeholder} replaced; unknown ones stay as written."""
    return _PLACEHOLDER.sub(lambda m: values.get(m.group(1), m.group(0)), template)


def _date(on: date) -> str:
    return f"{on:%d %b %Y}"


def receipt_text(template: str, receipt: ReceiptMessage) -> str:
    block = _card_block(
        [
            (
                line.description,
                [
                    ("Paid", line.paid),
                    ("  Interest", line.interest_paid),
                    ("  Principal", line.principal_paid),
                    ("Still owed", line.owed_after),
                ],
            )
            for line in receipt.lines
        ],
        [("Total paid", receipt.amount), ("Total owed", receipt.total_owed)],
    )
    return fill(
        template,
        {
            "customer_name": receipt.customer_name,
            "amount": format_inr(receipt.amount),
            "method": receipt.method,
            "date": _date(receipt.paid_on),
            "reference": receipt.reference or "",
            "mortgages": block,
            "total_owed": format_inr(receipt.total_owed),
        },
    )


def notice_text(template: str, notice: NoticeMessage) -> str:
    interest = sum(line.interest for line in notice.lines)
    owed = sum(line.owed_after for line in notice.lines)
    block = _card_block(
        [
            (
                line.description,
                [("Interest added", line.interest), ("Owed after", line.owed_after)],
            )
            for line in notice.lines
        ],
        [("Total interest", interest), ("Total owed", owed)],
    )
    return fill(
        template,
        {
            "customer_name": notice.customer_name,
            "date": _date(notice.accrues_on),
            "interest": format_inr(interest),
            "mortgages": block,
            "total_owed": format_inr(owed),
        },
    )
