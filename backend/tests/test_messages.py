"""WhatsApp messages: Receipts and Notices rendered from the Lender's templates.

WhatsApp has no tables, so each Mortgage is a small card in a monospace block, its
amounts right-aligned. Customers see the item, never the Mortgage Name.
"""

from datetime import date

from mortgage_backend.messages import (
    NOTICE_PLACEHOLDERS,
    RECEIPT_PLACEHOLDERS,
    NoticeLine,
    NoticeMessage,
    ReceiptLine,
    ReceiptMessage,
    fill,
    notice_text,
    receipt_text,
    unknown_placeholders,
)
from seed import RUPEE


RECEIPT = (
    "*Payment received*\n"
    "Namaste {customer_name}, we received *{amount}* by {method} on {date}.\n"
    "{mortgages}\n"
    "Total still owed: *{total_owed}*"
)


def chain(**overrides: int) -> ReceiptLine:
    values = {
        "paid": 5_000 * RUPEE,
        "interest_paid": 3_000 * RUPEE,
        "principal_paid": 2_000 * RUPEE,
        "owed_after": 1_02_000 * RUPEE,
    }
    return ReceiptLine(description="Gold chain", **{**values, **overrides})


def receipt(*lines: ReceiptLine) -> ReceiptMessage:
    return ReceiptMessage(
        customer_name="Ramesh Kumar",
        paid_on=date(2026, 4, 15),
        amount=sum(line.paid for line in lines),
        method="Cash",
        lines=list(lines),
    )


def test_a_receipt_fills_the_template_with_a_card_for_the_mortgage() -> None:
    assert receipt_text(RECEIPT, receipt(chain())) == (
        "*Payment received*\n"
        "Namaste Ramesh Kumar, we received *₹5,000* by Cash on 15 Apr 2026.\n"
        "```\n"
        "Gold chain\n"
        "Paid              ₹5,000\n"
        "  Interest        ₹3,000\n"
        "  Principal       ₹2,000\n"
        "Still owed     ₹1,02,000\n"
        "```\n"
        "Total still owed: *₹1,02,000*"
    )


def test_several_mortgages_get_a_card_each_and_totals() -> None:
    bangles = ReceiptLine(
        description="Two bangles",
        paid=2_000 * RUPEE,
        interest_paid=2_000 * RUPEE,
        principal_paid=0,
        owed_after=50_000 * RUPEE,
    )

    text = receipt_text("{mortgages}", receipt(chain(), bangles))

    assert text == (
        "```\n"
        "Gold chain\n"
        "Paid              ₹5,000\n"
        "  Interest        ₹3,000\n"
        "  Principal       ₹2,000\n"
        "Still owed     ₹1,02,000\n"
        "\n"
        "Two bangles\n"
        "Paid              ₹2,000\n"
        "  Interest        ₹2,000\n"
        "  Principal           ₹0\n"
        "Still owed       ₹50,000\n"
        "────────────────────────\n"
        "Total paid        ₹7,000\n"
        "Total owed     ₹1,52,000\n"
        "```"
    )


def test_a_card_widens_for_a_large_amount_and_wraps_a_long_item() -> None:
    big = ReceiptLine(
        description="Necklace with matching earrings set",
        paid=10_00_000 * RUPEE,
        interest_paid=3_000 * RUPEE,
        principal_paid=9_97_000 * RUPEE,
        owed_after=1_23_45_678_90,
    )

    card = receipt_text("{mortgages}", receipt(big)).splitlines()

    assert card[1:3] == ["Necklace with matching", "earrings set"]
    assert card[3:7] == [
        "Paid            ₹10,00,000",
        "  Interest          ₹3,000",
        "  Principal      ₹9,97,000",
        "Still owed ₹1,23,45,678.90",
    ]


def test_the_reference_can_be_placed_in_the_message() -> None:
    paid = receipt(chain()).model_copy(update={"reference": "UTR 4711"})

    assert receipt_text("Ref: {reference}", paid) == "Ref: UTR 4711"


def test_unknown_placeholders_are_left_as_written() -> None:
    assert fill("Hi {customer_name}, {not_a_field}", {"customer_name": "Ramesh"}) == (
        "Hi Ramesh, {not_a_field}"
    )


def test_a_notice_shows_the_interest_about_to_be_added() -> None:
    notice = NoticeMessage(
        customer_name="Ramesh Kumar",
        accrues_on=date(2026, 5, 14),
        lines=[
            NoticeLine(
                description="Gold chain",
                interest=3_000 * RUPEE,
                owed_after=1_12_000 * RUPEE,
            ),
            NoticeLine(
                description="Ring", interest=1_500 * RUPEE, owed_after=51_500 * RUPEE
            ),
        ],
    )

    text = notice_text(
        "On {date}, *{interest}* of interest will be added.\n{mortgages}\n"
        "You will owe *{total_owed}*.",
        notice,
    )

    assert text == (
        "On 14 May 2026, *₹4,500* of interest will be added.\n"
        "```\n"
        "Gold chain\n"
        "Interest added    ₹3,000\n"
        "Owed after     ₹1,12,000\n"
        "\n"
        "Ring\n"
        "Interest added    ₹1,500\n"
        "Owed after       ₹51,500\n"
        "────────────────────────\n"
        "Total interest    ₹4,500\n"
        "Total owed     ₹1,63,500\n"
        "```\n"
        "You will owe *₹1,63,500*."
    )


def test_every_placeholder_a_template_may_use_is_filled() -> None:
    def every(placeholders: tuple[str, ...]) -> str:
        return " ".join("{" + name + "}" for name in placeholders)

    worded = [
        receipt_text(every(RECEIPT_PLACEHOLDERS), receipt(chain())),
        notice_text(
            every(NOTICE_PLACEHOLDERS),
            NoticeMessage(
                customer_name="Ramesh Kumar",
                accrues_on=date(2026, 5, 14),
                lines=[
                    NoticeLine(
                        description="Gold chain",
                        interest=3_000 * RUPEE,
                        owed_after=1_12_000 * RUPEE,
                    )
                ],
            ),
        ),
    ]

    assert all("{" not in text for text in worded)


def test_placeholders_a_template_may_not_use_are_named_once_each() -> None:
    template = "Namaste {name}, {amount} paid; {name} owes {interest} {total_owed}"

    assert unknown_placeholders(template, RECEIPT_PLACEHOLDERS) == [
        "{name}",
        "{interest}",
    ]
    assert unknown_placeholders(RECEIPT, RECEIPT_PLACEHOLDERS) == []


def test_braces_that_are_not_exactly_a_placeholder_are_named_as_written() -> None:
    template = "{customer-name} { amount } {Date} {{total_owed}} owes {total_owed"

    assert unknown_placeholders(template, RECEIPT_PLACEHOLDERS) == [
        "{customer-name}",
        "{ amount }",
        "{Date}",
        "{",
        "{total_owed",
    ]
