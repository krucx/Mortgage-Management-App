"""A Call Note follows the same rules whether added on its own (always dated today) or
imported from a filled-in Call Sheet: only on an Active Mortgage (a Dormant one is
Active), never empty, dated neither after today nor before the Mortgage started, and
an exact duplicate is kept once. Today is 20 Apr 2026."""

from io import BytesIO

import pytest
from api_seed import SIMPLE_3, lend, pay, person
from openpyxl import Workbook

COLUMNS = ["Mortgage Name", "Called on", "Call Note"]


@pytest.fixture
def ramesh(client):
    return person(client)


@pytest.fixture
def chain(client, ramesh):
    return lend(client, ramesh)  # from 14 Jan 2026


@pytest.fixture
def redeemed(client, ramesh):
    ring = lend(client, ramesh, description="Gold ring")
    response = client.post(
        f"/api/mortgages/{ring['id']}/redeem",
        json={"redeemed_on": "2026-04-20", "method": "upi"},
    )
    assert response.status_code == 200, response.text
    return ring


@pytest.fixture
def dormant(client, ramesh):
    """Active, owing nothing: paid off by back-dated Payments (see test_dormant)."""
    bangle = lend(
        client,
        ramesh,
        description="Gold bangle",
        terms={**SIMPLE_3, "part_month_rule": "nothing"},
    )
    pay(client, ramesh, {bangle["id"]: 3_000_00}, on="2026-04-15")
    pay(client, ramesh, {bangle["id"]: 50_000_00}, on="2026-04-10")
    pay(client, ramesh, {bangle["id"]: 56_000_00}, on="2026-04-09")
    shown = client.get(f"/api/mortgages/{bangle['id']}").json()
    assert (shown["status"], shown["outstanding"]["total"]) == ("active", 0)
    return bangle


def call(client, mortgage, note):
    return client.post(f"/api/mortgages/{mortgage['id']}/call-notes", json={"note": note})


def notes_of(client, mortgage) -> list[tuple[str, str]]:
    response = client.get(f"/api/mortgages/{mortgage['id']}/call-notes")
    assert response.status_code == 200, response.text
    return [(n["called_on"], n["note"]) for n in response.json()]


def sheet(*rows: tuple[str, object, str]) -> bytes:
    """A Call Sheet as staff hand it back: Mortgage Name, Called on and Call Note."""
    workbook = Workbook()
    workbook.active.append(COLUMNS)
    for row in rows:
        workbook.active.append(list(row))
    out = BytesIO()
    workbook.save(out)
    return out.getvalue()


def imported(client, *rows: tuple[str, object, str]):
    response = client.post(
        "/api/call-list/import", files={"file": ("call-list.xlsx", sheet(*rows))}
    )
    assert response.status_code == 200, response.text
    return response.json()


# --- Active only (a Dormant Mortgage is Active)


def test_a_call_note_on_a_closed_mortgage_is_refused_with_why(client, redeemed):
    response = call(client, redeemed, "Collected the ring")

    assert response.status_code == 422
    assert response.json()["detail"] == f"{redeemed['name']}: it is redeemed"
    assert notes_of(client, redeemed) == []


def test_an_imported_call_note_on_a_closed_mortgage_is_left_out(client, redeemed):
    result = imported(client, (redeemed["name"], "2026-04-20", "Collected the ring"))

    assert [r["reason"] for r in result["not_imported"]] == ["it is redeemed"]
    assert notes_of(client, redeemed) == []


def test_a_dormant_mortgage_takes_call_notes_both_ways(client, dormant):
    assert call(client, dormant, "Asked to collect").status_code == 201
    imported(client, (dormant["name"], "2026-04-18", "No answer"))

    assert sorted(notes_of(client, dormant)) == [
        ("2026-04-18", "No answer"),
        ("2026-04-20", "Asked to collect"),
    ]


# --- Not empty


@pytest.mark.parametrize("note", ["", "   "])
def test_an_empty_call_note_is_refused(client, chain, note):
    response = call(client, chain, note)

    assert response.status_code == 422
    assert response.json()["detail"] == f"{chain['name']}: the Call Note is empty"
    assert notes_of(client, chain) == []


def test_an_imported_row_with_no_call_note_is_skipped(client, chain):
    result = imported(client, (chain["name"], "2026-04-20", ""))

    assert (result["adding"], result["skipped_empty"]) == ([], 1)


# --- Dated neither after today nor before the Mortgage started (only an imported Call
# Note can be: a single one is dated today, and no Mortgage starts after today)


def test_a_single_call_note_is_dated_today(client, chain):
    response = call(client, chain, "Will pay Friday")

    assert response.status_code == 201, response.text
    assert response.json()["called_on"] == "2026-04-20"


@pytest.mark.parametrize(
    ("called_on", "reason"),
    [
        ("2026-04-21", "Called on is after today"),
        ("2026-01-13", "Called on is before the Mortgage started"),
    ],
)
def test_an_imported_call_note_dated_outside_the_mortgage_is_left_out(
    client, chain, called_on, reason
):
    result = imported(client, (chain["name"], called_on, "Will pay Friday"))

    assert [r["reason"] for r in result["not_imported"]] == [reason]
    assert notes_of(client, chain) == []


# --- An exact duplicate is kept once


def test_the_same_call_note_twice_the_same_day_keeps_one(client, chain):
    first = call(client, chain, "Will pay Friday")
    again = call(client, chain, " Will pay Friday ")

    assert again.status_code == 201, again.text
    assert again.json()["id"] == first.json()["id"]
    assert notes_of(client, chain) == [("2026-04-20", "Will pay Friday")]


def test_an_imported_duplicate_of_a_stored_call_note_is_skipped(client, chain):
    call(client, chain, "Will pay Friday")

    result = imported(client, (chain["name"], "2026-04-20", "Will pay Friday"))

    assert (result["adding"], result["skipped_duplicates"]) == ([], 1)
    assert notes_of(client, chain) == [("2026-04-20", "Will pay Friday")]
