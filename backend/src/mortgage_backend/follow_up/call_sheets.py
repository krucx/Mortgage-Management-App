"""The Call Sheet (see Documentation/GLOSSARY.md): the day's Call List exported to Excel or PDF for
whoever makes the calls, and the Excel sheet, with the Call Notes written in,
imported back in one go.

Each row is one listed Mortgage, its Customer's rows together, ending with two columns
to fill in: Called on (the export date, to change if called another day) and Call
Note. An import adds every note it can: a note naming no Mortgage, an unknown or
closed one, or without a usable Called on date is left out and named by its row.
Empty notes are only counted, and so is a note its Mortgage already has for that date,
so importing a sheet twice adds nothing.
"""

from collections import defaultdict
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from datetime import date, datetime
from io import BytesIO
from pathlib import Path
from typing import Any
from zipfile import BadZipFile

from fastapi import APIRouter, Response, UploadFile
from fpdf import FPDF
from fpdf.fonts import FontFace
from openpyxl import Workbook, load_workbook
from openpyxl.styles import Font
from openpyxl.utils import get_column_letter
from pydantic import BaseModel
from sqlalchemy import insert, select
from sqlalchemy.engine import Connection

from mortgage_backend.follow_up import call_notes
from mortgage_backend.follow_up.call_list import CallListRow, call_list
from mortgage_backend.platform.clock import TodayDep
from mortgage_backend.platform.db import (
    EngineDep,
    call_note_table,
    customer_table,
    mortgage_table,
)
from mortgage_backend.platform.errors import unprocessable
from mortgage_backend.platform.money import RUPEE, format_inr


class SheetRow(BaseModel):
    """One listed Mortgage, as the Call Sheet shows it."""

    customer: str
    phones: str
    mortgage_name: str
    description: str
    reasons: str  # why it is listed, in glossary words
    months_unpaid: int
    outstanding: int  # paise
    loan_to_value: float | None
    last_call_note: str | None


@dataclass(frozen=True)
class Column:
    """One column of the Call Sheet: its heading, its value in Excel and as printed
    (both given the row and the export date), and its widths."""

    heading: str
    excel: Callable[[SheetRow, date], object]
    printed: Callable[[SheetRow, date], str]
    excel_width: int  # characters
    pdf_width: int  # mm, the columns filling a landscape A4 page's 277 mm
    excel_format: str | None = None


# Rupees with Indian digit grouping (1,12,000), as the app writes them.
_RUPEES = '[>=10000000]"₹"##\\,##\\,##\\,##0;[>=100000]"₹"##\\,##\\,##0;"₹"#,##0'


def _percent(value: float | None) -> str:
    return "" if value is None else f"{value:.0%}"


COLUMNS = [
    Column("Customer", lambda r, _: r.customer, lambda r, _: r.customer, 18, 24),
    Column("Phone numbers", lambda r, _: r.phones, lambda r, _: r.phones, 16, 23),
    Column(
        "Mortgage Name",
        lambda r, _: r.mortgage_name,
        lambda r, _: r.mortgage_name,
        24,
        42,
    ),
    Column("Jewellery", lambda r, _: r.description, lambda r, _: r.description, 24, 24),
    Column("Why listed", lambda r, _: r.reasons, lambda r, _: r.reasons, 18, 23),
    Column(
        "Months Unpaid",
        lambda r, _: r.months_unpaid,
        lambda r, _: str(r.months_unpaid),
        9,
        16,
    ),
    Column(
        "Outstanding",
        lambda r, _: r.outstanding // RUPEE,
        lambda r, _: format_inr(r.outstanding),
        12,
        23,
        _RUPEES,
    ),
    Column(
        "Loan-to-Value",
        lambda r, _: r.loan_to_value,
        lambda r, _: _percent(r.loan_to_value),
        9,
        18,
        "0%",
    ),
    Column(
        "Last Call Note",
        lambda r, _: r.last_call_note,
        lambda r, _: r.last_call_note or "",
        28,
        30,
    ),
    # To fill in: when the call was made (today, unless changed) and what it came to.
    Column(
        "Called on",
        lambda _, today: today,
        lambda _, today: f"{today:%d %b %Y}",
        13,
        17,
        "DD MMM YYYY",
    ),
    Column("Call Note", lambda r, _: None, lambda r, _: "", 40, 37),
]
# What an import reads back.
_MORTGAGE_NAME, _CALLED_ON, _CALL_NOTE = "Mortgage Name", "Called on", "Call Note"

_FONTS = Path(__file__).parent / "fonts"  # DejaVu Sans, which has the ₹ sign


def _reasons(row: CallListRow) -> str:
    """Why the Mortgage is listed, in glossary words."""
    reasons = {
        "months_unpaid": f"{row.months_unpaid} Months Unpaid",
        "loan_to_value": f"Loan-to-Value {_percent(row.loan_to_value)}",
        "accrues_today": "Accrues today",
    }
    return ", ".join(reasons[reason] for reason in row.reasons)


def sheet_rows(conn: Connection, today: date) -> list[SheetRow]:
    """Today's Call List, most urgent Customer first, a row per Mortgage."""
    groups = call_list(conn, today)
    ids = [row.mortgage_id for group in groups for row in group.rows]
    descriptions = dict(
        conn.execute(
            select(mortgage_table.c.id, mortgage_table.c.description).where(
                mortgage_table.c.id.in_(ids)
            )
        ).all()
    )
    last_notes: dict[int, str] = {}  # each Mortgage's latest Call Note, as a line
    for note in conn.execute(
        select(call_note_table)
        .where(call_note_table.c.mortgage_id.in_(ids))
        .order_by(call_note_table.c.id)
    ):
        last_notes[note.mortgage_id] = f"{note.called_on:%d %b %Y}: {note.note}"
    return [
        SheetRow(
            customer=group.customer.name,
            phones=", ".join(p for p in (group.phone_1, group.phone_2) if p),
            mortgage_name=row.mortgage_name,
            description=descriptions[row.mortgage_id],
            reasons=_reasons(row),
            months_unpaid=row.months_unpaid,
            outstanding=row.outstanding,
            loan_to_value=row.loan_to_value,
            last_call_note=last_notes.get(row.mortgage_id),
        )
        for group in groups
        for row in group.rows
    ]


def excel_sheet(rows: Sequence[SheetRow], today: date) -> bytes:
    """The Call Sheet as an Excel workbook, headings frozen above the rows."""
    workbook = Workbook()
    sheet = workbook.active
    assert sheet is not None  # a new Workbook has one sheet
    sheet.title = f"Call List {today:%d %b %Y}"
    sheet.append([column.heading for column in COLUMNS])
    for cell in sheet[1]:
        cell.font = Font(bold=True)
    for row in rows:
        sheet.append([column.excel(row, today) for column in COLUMNS])
    for index, column in enumerate(COLUMNS, start=1):
        sheet.column_dimensions[get_column_letter(index)].width = column.excel_width
        if column.excel_format:
            for (cell,) in sheet.iter_rows(min_row=2, min_col=index, max_col=index):
                cell.number_format = column.excel_format
    sheet.freeze_panes = "A2"
    out = BytesIO()
    workbook.save(out)
    return out.getvalue()


def pdf_sheet(rows: Sequence[SheetRow], today: date) -> bytes:
    """The Call Sheet to print: a landscape A4 table, headings on every page."""
    pdf = FPDF(orientation="landscape", format="A4")
    pdf.add_font("DejaVu", "", str(_FONTS / "DejaVuSans.ttf"))
    pdf.add_font("DejaVu", "B", str(_FONTS / "DejaVuSans-Bold.ttf"))
    pdf.set_margins(10, 10)
    pdf.add_page()
    pdf.set_font("DejaVu", "B", 14)
    pdf.cell(text=f"Call List, {today:%d %b %Y}", new_x="LMARGIN", new_y="NEXT")
    pdf.ln(3)
    pdf.set_font("DejaVu", size=7.5)
    with pdf.table(
        col_widths=[column.pdf_width for column in COLUMNS],
        headings_style=FontFace(emphasis="BOLD", fill_color=(235, 235, 235)),
        line_height=5,
        padding=1.5,
        text_align="LEFT",
        repeat_headings=1,
    ) as table:
        # (Broken where the narrow column would otherwise break mid-word.)
        table.row([c.heading.replace("Loan-to-", "Loan-to-\n") for c in COLUMNS])
        for row in rows:
            table.row([column.printed(row, today) for column in COLUMNS])
    return bytes(pdf.output())


class ImportedCallNote(BaseModel):
    """A Call Note an import adds."""

    mortgage_id: int
    mortgage_name: str
    customer_name: str
    called_on: date
    note: str


class NotImported(BaseModel):
    """A filled-in row an import leaves out, and why."""

    row: int  # as Excel numbers it
    mortgage_name: str | None  # None when the row names none
    note: str
    reason: str


class CallNoteImport(BaseModel):
    """What an import adds, and what it leaves out."""

    adding: list[ImportedCallNote]
    not_imported: list[NotImported]  # in sheet order
    skipped_empty: int  # rows with no Call Note written in
    skipped_duplicates: int  # notes their Mortgage already has for that date


def _as_date(value: Any) -> date | None:
    """A Called on cell as a date: an Excel date, or one typed as text."""
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    if isinstance(value, str):
        for form in (
            "%Y-%m-%d",
            "%d %b %Y",
            "%d/%m/%Y",
            "%d-%m-%Y",
            "%d-%b-%Y",
            "%d %b %y",
            "%d/%m/%y",
        ):
            try:
                return datetime.strptime(value.strip(), form).date()
            except ValueError:
                pass
    return None


def _filled_rows(data: bytes) -> list[tuple[int, dict[str, Any]]]:
    """Each row below the headings, with its Excel row number, as Mortgage Name,
    Called on and Call Note (found by heading, wherever the headings row and those
    columns now are)."""
    try:
        sheet = load_workbook(BytesIO(data), read_only=True, data_only=True).active
    except (BadZipFile, KeyError, OSError, ValueError):
        raise unprocessable(
            "This file is not an Excel sheet (.xlsx): import the Call List exported "
            "as Excel, with the Call Notes filled in"
        ) from None
    rows = list(sheet.iter_rows(values_only=True)) if sheet is not None else []
    wanted = (_MORTGAGE_NAME, _CALLED_ON, _CALL_NOTE)
    for at, row in enumerate(rows[:10]):
        headings = [str(cell).strip() if cell is not None else "" for cell in row]
        if set(wanted) <= set(headings):
            column_of = {name: headings.index(name) for name in wanted}
            return [
                (
                    number,
                    {
                        name: row[i] if i < len(row) else None
                        for name, i in column_of.items()
                    },
                )
                for number, row in enumerate(rows[at + 1 :], start=at + 2)
            ]
    raise unprocessable(
        "This sheet has no Mortgage Name, Called on and Call Note columns: export the "
        "Call List as Excel and fill that in"
    )


def _left_out_because(
    name: str, mortgage: Any, called_on: date | None, note: str, today: date
) -> str | None:
    """Why a row with a Call Note can't be imported, if it can't: the sheet's own
    reasons, then the rules for every Call Note."""
    if not name:
        return "no Mortgage Name"
    if mortgage is None:
        return "no such Mortgage"
    if called_on is None:
        return "Called on is not a date"
    return call_notes.left_out_because(mortgage, called_on, note, today)


def read_import(conn: Connection, data: bytes, today: date) -> CallNoteImport:
    """The Call Notes a filled-in sheet would add, and each filled-in row it would
    leave out, with why."""
    filled = _filled_rows(data)
    mortgages = {  # by Mortgage Name, unique ignoring case
        row.name.casefold(): row
        for row in conn.execute(
            select(
                mortgage_table.c.id,
                mortgage_table.c.name,
                mortgage_table.c.status,
                mortgage_table.c.start_date,
                customer_table.c.name.label("customer_name"),
            ).join(customer_table, customer_table.c.id == mortgage_table.c.customer_id)
        )
    }
    noted: dict[int, set[tuple[date, str]]] = defaultdict(set)  # by Mortgage
    for stored in conn.execute(select(call_note_table)):
        noted[stored.mortgage_id].add((stored.called_on, stored.note))

    adding: list[ImportedCallNote] = []
    left_out: list[NotImported] = []
    empty = duplicates = 0
    for number, row in filled:
        name = str(row[_MORTGAGE_NAME] or "").strip()
        note = str(row[_CALL_NOTE] or "").strip()
        if not note:
            empty += 1 if name else 0
            continue
        mortgage = mortgages.get(name.casefold())
        called_on = _as_date(row[_CALLED_ON])
        reason = _left_out_because(name, mortgage, called_on, note, today)
        if reason is not None:
            shown = mortgage.name if mortgage is not None else (name or None)
            left_out.append(
                NotImported(row=number, mortgage_name=shown, note=note, reason=reason)
            )
            continue
        assert mortgage is not None and called_on is not None  # as checked above
        if (called_on, note) in noted[mortgage.id]:
            duplicates += 1
        else:
            noted[mortgage.id].add((called_on, note))
            adding.append(
                ImportedCallNote(
                    mortgage_id=mortgage.id,
                    mortgage_name=mortgage.name,
                    customer_name=mortgage.customer_name,
                    called_on=called_on,
                    note=note,
                )
            )
    return CallNoteImport(
        adding=adding,
        not_imported=left_out,
        skipped_empty=empty,
        skipped_duplicates=duplicates,
    )


router = APIRouter(prefix="/api")

_XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


def _download(content: bytes, file_name: str, media_type: str) -> Response:
    return Response(
        content,
        media_type=media_type,
        headers={"Content-Disposition": f'attachment; filename="{file_name}"'},
    )


@router.get("/call-list/export.xlsx", response_class=Response)
def export_excel(engine: EngineDep, today: TodayDep) -> Response:
    """Today's Call Sheet in Excel, with Called on and Call Note to fill in."""
    with engine.connect() as conn:
        rows = sheet_rows(conn, today)
    return _download(excel_sheet(rows, today), f"call-list-{today}.xlsx", _XLSX)


@router.get("/call-list/export.pdf", response_class=Response)
def export_pdf(engine: EngineDep, today: TodayDep) -> Response:
    """Today's Call Sheet to print, with room to write what each call came to."""
    with engine.connect() as conn:
        rows = sheet_rows(conn, today)
    return _download(
        pdf_sheet(rows, today), f"call-list-{today}.pdf", "application/pdf"
    )


@router.post("/call-list/import-preview")
async def preview_import(
    file: UploadFile, engine: EngineDep, today: TodayDep
) -> CallNoteImport:
    """The Call Notes a filled-in Call Sheet would add, saving nothing."""
    data = await file.read()
    with engine.connect() as conn:
        return read_import(conn, data, today)


@router.post("/call-list/import")
async def import_call_notes(
    file: UploadFile, engine: EngineDep, today: TodayDep
) -> CallNoteImport:
    """Add every Call Note a filled-in Call Sheet holds that can be added."""
    data = await file.read()
    with engine.begin() as conn:
        imported = read_import(conn, data, today)
        if imported.adding:
            conn.execute(
                insert(call_note_table),
                [
                    {
                        "mortgage_id": note.mortgage_id,
                        "called_on": note.called_on,
                        "note": note.note,
                    }
                    for note in imported.adding
                ],
            )
        return imported
