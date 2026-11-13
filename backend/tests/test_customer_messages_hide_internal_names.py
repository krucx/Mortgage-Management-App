"""Nothing sent to a Customer shows a Mortgage Name or an id (decided in #7/#17).

Mortgages are labelled by their description, and by start date when two of a Customer's
share one. Each template is filled with *every* placeholder it allows, so a placeholder
added later that exposes a Mortgage Name fails here.
"""

import json
import re

import pytest
from api_seed import lend, pay, person
from seed import RUPEE

from mortgage_backend.follow_up.message_settings import (
    RECEIPT_TEMPLATE,
    REMINDER_TEMPLATE,
)
from mortgage_backend.follow_up.messages import (
    RECEIPT_PLACEHOLDERS,
    REMINDER_PLACEHOLDERS,
)

NAMES = ("2026-Zorblax-Anklet", "2026-Zorblax-Anklet-Again")


def all_placeholders(placeholders: tuple[str, ...]) -> str:
    return "\n".join("{" + name + "}" for name in placeholders)


@pytest.fixture
def mortgages(client):
    """Two Mortgages described alike, a start date apart, with distinctive names."""
    zorblax = person(client, name="Zorblax Patel")
    first = lend(client, zorblax, "2026-01-14", description="Silver anklet", name=NAMES[0])
    second = lend(client, zorblax, "2026-02-14", description="Silver anklet", name=NAMES[1])
    return zorblax, first, second


def use_templates(client, receipt: str, reminder: str) -> None:
    settings = client.get("/api/settings/messages").json()
    response = client.put(
        "/api/settings/messages",
        json={
            **settings,
            "receipt_template": receipt,
            "reminder_template": reminder,
            "reminder_days_before": 28,  # queues the 14 May Reminders from 20 Apr
        },
    )
    assert response.status_code == 200, response.text


def assert_hides_internal_names(text: str, ids: list[int]) -> None:
    """`text` tells the two Mortgages apart by start date, and shows neither name nor id."""
    unwrapped = " ".join(text.split())  # a card wraps a long title
    assert "Silver anklet (from 14 Jan 2026)" in unwrapped
    assert "Silver anklet (from 14 Feb 2026)" in unwrapped
    assert "Zorblax Patel" in text
    assert "Zorblax-Anklet" not in text
    for internal in ids:
        # Not inside a longer number: amounts and dates have digits of their own
        assert not re.search(rf"(?<![\d,.]){internal}(?![\d,])", text), internal


@pytest.mark.parametrize(
    "templates",
    [
        pytest.param((RECEIPT_TEMPLATE, REMINDER_TEMPLATE), id="default"),
        pytest.param(
            (all_placeholders(RECEIPT_PLACEHOLDERS), all_placeholders(REMINDER_PLACEHOLDERS)),
            id="customised, every placeholder",
        ),
    ],
)
def test_customer_messages_show_no_mortgage_name_or_id(client, mortgages, templates):
    zorblax, first, second = mortgages
    paid = pay(client, zorblax, {first["id"]: 1_000 * RUPEE, second["id"]: 1_000 * RUPEE})
    use_templates(client, *templates)
    ids = [first["id"], second["id"], zorblax["id"], paid["id"]]

    receipt = client.get(f"/api/payments/{paid['id']}/receipt").json()
    [reminder] = client.get("/api/reminders").json()["items"]

    assert_hides_internal_names(receipt["text"], ids)
    assert_hides_internal_names(reminder["message"], [*ids, reminder["id"]])
    # The printed Receipt is drawn from these lines: besides the description, a line
    # carries only the id the Lender's links use (the frontend test checks it isn't shown).
    assert NAMES[0] not in json.dumps(receipt)
    assert [line["description"] for line in receipt["lines"]] == [
        "Silver anklet (from 14 Jan 2026)",
        "Silver anklet (from 14 Feb 2026)",
    ]
