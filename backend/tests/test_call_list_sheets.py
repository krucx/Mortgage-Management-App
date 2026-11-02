"""The Call List as a sheet for staff: exported to Excel or PDF, then the Excel sheet,
with their Call Notes filled in, imported in one go (today is 20 Apr 2026)."""

from datetime import date, datetime
from io import BytesIO

import pytest
from api_seed import lend, pay, person
from openpyxl import Workbook, load_workbook

HEADER = [
    "Customer",
    "Phone numbers",
    "Mortgage Name",
    "Jewellery",
    "Why listed",
    "Months Unpaid",
    "Outstanding",
    "Loan-to-Value",
    "Last Call Note",
    "Called on",
    "Call Note",
]


@pytest.fixture
def book(client):
    """Ramesh's chain, 3 Months Unpaid and called once already; Sita's ring, accruing
    today; and Ramesh's bangle, paid up to date and not listed."""
    ramesh = person(client)
    chain = lend(client, ramesh)
    bangle = lend(client, ramesh, "2026-03-25", description="Gold bangle")
    pay(client, ramesh, {bangle["id"]: 3_000_00}, on="2026-04-19")
    note = client.post(
        f"/api/mortgages/{chain['id']}/call-notes", json={"note": "Promised Friday"}
    )
    assert note.status_code == 201, note.text
    sita = person(client, "Sita Devi", "9829054321", phone_2="9414000000")
    ring = lend(client, sita, "2026-03-20", description="Gold ring")
    return {"chain": chain, "ring": ring, "bangle": bangle}


def exported(client) -> Workbook:
    response = client.get("/api/call-list/export.xlsx")
    assert response.status_code == 200, response.text
    assert "call-list-2026-04-20.xlsx" in response.headers["content-disposition"]
    return load_workbook(BytesIO(response.content))


def rows_of(workbook: Workbook) -> list[list[object]]:
    return [list(row) for row in workbook.active.iter_rows(values_only=True)]


def test_the_excel_sheet_lists_each_mortgage_by_customer_with_columns_to_fill_in(
    client, book
):
    header, *rows = rows_of(exported(client))

    assert header == HEADER
    today = datetime(2026, 4, 20)
    assert rows == [
        [
            "Sita Devi",
            "9829054321, 9414000000",
            book["ring"]["name"],
            "Gold ring",
            "Accrues today",
            1,
            106_000,
            None,
            None,
            today,
            None,
        ],
        [
            "Ramesh Kumar",
            "9829012345",
            book["chain"]["name"],
            "Gold chain",
            "3 Months Unpaid",
            3,
            112_000,
            None,
            "20 Apr 2026: Promised Friday",
            today,
            None,
        ],
    ]


def test_the_pdf_is_a_printable_call_list(client, book):
    response = client.get("/api/call-list/export.pdf")

    assert response.status_code == 200, response.text
    assert response.headers["content-type"] == "application/pdf"
    assert "call-list-2026-04-20.pdf" in response.headers["content-disposition"]
    assert response.content.startswith(b"%PDF")


def filled(client, notes: dict[str, str | None], **called_on: date) -> bytes:
    """The exported sheet with `notes` written in, by Mortgage Name (and any Called on
    date changed), as staff would hand it back."""
    workbook = exported(client)
    sheet = workbook.active
    for row in sheet.iter_rows(min_row=2):
        name = row[2].value
        if name in notes:
            row[10].value = notes[name]
        if name in called_on:
            row[9].value = called_on[name]
    out = BytesIO()
    workbook.save(out)
    return out.getvalue()


def upload(client, sheet: bytes, preview: bool = False):
    return client.post(
        "/api/call-list/import" + ("-preview" if preview else ""),
        files={"file": ("call-list.xlsx", sheet)},
    )


def notes_of(client, mortgage) -> list[tuple[str, str]]:
    response = client.get(f"/api/mortgages/{mortgage['id']}/call-notes")
    return [(n["called_on"], n["note"]) for n in response.json()]


def test_the_preview_shows_the_notes_it_would_add_skipping_empty_rows_and_saves_nothing(
    client, book
):
    sheet = filled(client, {book["ring"]["name"]: "  No answer  "})

    response = upload(client, sheet, preview=True)

    assert response.status_code == 200, response.text
    assert response.json() == {
        "adding": [
            {
                "mortgage_id": book["ring"]["id"],
                "mortgage_name": book["ring"]["name"],
                "customer_name": "Sita Devi",
                "called_on": "2026-04-20",
                "note": "No answer",
            }
        ],
        "skipped_empty": 1,
        "skipped_duplicates": 0,
    }
    assert notes_of(client, book["ring"]) == []


def test_importing_adds_every_note_on_its_date_and_importing_again_adds_nothing(
    client, book
):
    sheet = filled(
        client,
        {book["ring"]["name"]: "No answer", book["chain"]["name"]: "Paying Monday"},
        **{book["chain"]["name"]: datetime(2026, 4, 18)},
    )

    first = upload(client, sheet)
    again = upload(client, sheet)

    assert first.status_code == 200, first.text
    assert len(first.json()["adding"]) == 2
    assert notes_of(client, book["ring"]) == [("2026-04-20", "No answer")]
    assert notes_of(client, book["chain"]) == [
        ("2026-04-18", "Paying Monday"),
        ("2026-04-20", "Promised Friday"),
    ]
    assert again.status_code == 200, again.text
    assert (again.json()["adding"], again.json()["skipped_duplicates"]) == ([], 2)


def test_a_sheet_naming_a_closed_or_unknown_mortgage_is_refused_whole_and_names_them(
    client, book
):
    sheet = filled(client, {book["ring"]["name"]: "No answer"})
    workbook = load_workbook(BytesIO(sheet))
    sheet_rows = workbook.active
    sheet_rows.append(
        [
            "Ramesh Kumar",
            "",
            "2026-Ramesh-Gone",
            "",
            "",
            "",
            "",
            "",
            "",
            datetime(2026, 4, 20),
            "Moved away",
        ]
    )
    sheet_rows.append(
        [
            "Ramesh Kumar",
            "",
            book["bangle"]["name"],
            "",
            "",
            "",
            "",
            "",
            "",
            datetime(2026, 4, 20),
            "Thanked",
        ]
    )
    redeemed = client.post(
        f"/api/mortgages/{book['bangle']['id']}/redeem",
        json={"redeemed_on": "2026-04-20", "method": "upi"},
    )
    assert redeemed.status_code == 200, redeemed.text
    out = BytesIO()
    workbook.save(out)

    for preview in (True, False):
        response = upload(client, out.getvalue(), preview=preview)
        assert response.status_code == 422
        detail = response.json()["detail"]
        assert "2026-Ramesh-Gone: no such Mortgage" in detail
        assert f"{book['bangle']['name']}: it is redeemed" in detail
    assert notes_of(client, book["ring"]) == []


def test_a_note_without_a_called_on_date_is_refused(client, book):
    sheet = filled(
        client, {book["ring"]["name"]: "No answer"}, **{book["ring"]["name"]: None}
    )

    response = upload(client, sheet)

    assert response.status_code == 422
    assert (
        f"{book['ring']['name']}: Called on is not a date" in response.json()["detail"]
    )


def test_a_file_that_is_not_an_exported_call_list_is_refused(client):
    response = upload(client, b"not a spreadsheet")

    assert response.status_code == 422
    assert "not an Excel" in response.json()["detail"]


def test_a_title_row_added_above_the_headings_still_imports(client, book):
    workbook = load_workbook(
        BytesIO(filled(client, {book["ring"]["name"]: "No answer"}))
    )
    workbook.active.insert_rows(1)
    workbook.active["A1"] = "Calls for Monday"
    out = BytesIO()
    workbook.save(out)

    response = upload(client, out.getvalue())

    assert response.status_code == 200, response.text
    assert notes_of(client, book["ring"]) == [("2026-04-20", "No answer")]


def test_a_note_with_no_mortgage_name_is_refused_not_lost(client, book):
    workbook = load_workbook(BytesIO(filled(client, {})))
    workbook.active.append([None] * 9 + [datetime(2026, 4, 20), "Rang back later"])
    out = BytesIO()
    workbook.save(out)

    response = upload(client, out.getvalue())

    assert response.status_code == 422
    assert '"Rang back later": no Mortgage Name' in response.json()["detail"]
