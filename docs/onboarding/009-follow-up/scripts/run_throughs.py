"""Checks every figure and message chapter 009 shows, against the real follow-up code.

For the course's editors. Builds the sample book once in a temporary folder (never the
Lender's data), then works on fresh copies of its database through the real API, held
on 19 Oct 2026 (or another day, where a section says so): one copy that is only read,
and one per change, so no change leaks into another section's figures.

    cd backend && uv run python ../docs/onboarding/009-follow-up/scripts/run_throughs.py

Amounts print in rupees (the code works in paise). Each section is headed with the
lesson that quotes it (L1–L5, 99).
"""

import json
import shutil
import sqlite3
import subprocess
import sys
import tempfile
from datetime import date, datetime, time, timedelta
from io import BytesIO
from pathlib import Path

from fastapi.testclient import TestClient
from openpyxl import load_workbook
from sqlalchemy import create_engine, select

REPO = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(REPO / "docs" / "sample-book"))

import book  # noqa: E402

from mortgage_backend.follow_up.call_list import (  # noqa: E402
    CallListSettings,
    loan_to_value_too_high,
)
from mortgage_backend.follow_up.message_settings import (  # noqa: E402
    MessageSettings,
    template_refusal,
)
from mortgage_backend.follow_up.messages import (  # noqa: E402
    REMINDER_PLACEHOLDERS,
    ReminderLine,
    ReminderMessage,
    fill,
    reminder_text,
    unknown_placeholders,
)
from mortgage_backend.lending.ledger import months_unpaid  # noqa: E402
from mortgage_backend.lending.replay import replays  # noqa: E402
from mortgage_backend.main import create_app  # noqa: E402
from mortgage_backend.platform.db import mortgage_table  # noqa: E402

THE_DAY = book.THE_DAY
RUPEE = 100
RING, CHAIN, COIN, ANKLET, ARJUN_CHAIN, MANGALSUTRA = 1, 2, 3, 10, 8, 9
XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


def rs(paise: int | None) -> str:
    if paise is None:
        return "None"
    return f"{paise / RUPEE:,.2f}".removesuffix(".00")


def pct(ratio: float | None) -> str:
    return "None" if ratio is None else f"{ratio:.1%}"


class Copy:
    """A fresh copy of the built book's data folder, served by the real app on `day`."""

    def __init__(self, built: Path, name: str, day: date = THE_DAY) -> None:
        self.folder = built.parent / name
        shutil.copytree(built, self.folder / "data")
        self.db = self.folder / "data" / "mortgage.db"
        self.day = day
        app = create_app(f"sqlite:///{self.db}", today=lambda: self.day,
                         now=lambda: datetime.combine(self.day, time(11, 0)))
        self.api = TestClient(app)
        self.api.__enter__()

    def call(self, method: str, path: str, quiet: bool = False, **kw):
        r = getattr(self.api, method)("/api" + path, **kw)
        try:
            body = r.json() if r.content else None
        except ValueError:
            body = f"<{len(r.content)} bytes {r.headers.get('content-type')}>"
        detail = body.get("detail") if isinstance(body, dict) else None
        if isinstance(detail, list):
            detail = "; ".join(d["msg"] for d in detail)
        if not quiet:
            print(f"   {method.upper()} {path} -> {r.status_code}" + (f": {detail}" if detail else ""))
        return r.status_code, body

    def sql(self, query: str) -> None:
        with sqlite3.connect(self.db) as conn:
            cur = conn.execute(query)
            print("     sqlite>", " ".join(query.split()))
            print("     ", " | ".join(d[0] for d in cur.description))
            for row in cur.fetchall():
                print("     ", " | ".join("" if v is None else str(v) for v in row))

    def call_list(self, **params) -> None:
        _, page = self.call("get", "/call-list", quiet=True, params=params)
        print(f"   Call List: {page['total']} Customers, {page['mortgages']} Mortgages")
        for group in page["items"]:
            print(f"   - {group['customer']['name']} ({group['phone_1']}, {group['phone_2']})")
            for row in group["rows"]:
                called = row["called"] and f"called: {row['called']['note']!r}"
                print(f"       {row['mortgage_name']}: reasons={row['reasons']}"
                      f" months_unpaid={row['months_unpaid']} ltv={pct(row['loan_to_value'])}"
                      f" outstanding={rs(row['outstanding'])} {called or 'not called'}")

    def reminders(self, status: str | None = None) -> list[dict]:
        """Every Reminder (each read syncs first), across all pages."""
        params = {"status": status} if status else {}
        items, number = [], 1
        while True:
            _, page = self.call("get", "/reminders", quiet=True, params={**params, "page": number})
            items += page["items"]
            if len(items) >= page["total"]:
                return items
            number += 1

    def unsent(self) -> None:
        rows = [n for n in self.reminders() if n["status"] in ("awaiting_approval", "queued")]
        print(f"   unsent Reminders: {len(rows)}")
        for n in rows:
            print(f"     #{n['id']} {n['customer']['name']} accrues {n['accrues_on']}"
                  f" created {n['created_on']} {n['status']}"
                  f" mortgages={[m['name'] for m in n['mortgages']]}")

    def by_status(self) -> None:
        counts: dict[str, int] = {}
        for n in self.reminders():
            counts[n["status"]] = counts.get(n["status"], 0) + 1
        print(f"   Reminders by status: {counts}")


def main() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        folder = Path(tmp) / "book"
        book.write(folder)
        report(folder / "data")


def sheet_rows(data: bytes) -> list[list]:
    sheet = load_workbook(BytesIO(data)).active
    return [list(row) for row in sheet.iter_rows(values_only=True)]


def workbook_with(data: bytes, edits: dict[tuple[int, str], object]) -> bytes:
    """The exported workbook with cells changed, by (Excel row, heading)."""
    wb = load_workbook(BytesIO(data))
    sheet = wb.active
    headings = [c.value for c in sheet[1]]
    for (row, heading), value in edits.items():
        sheet.cell(row=row, column=headings.index(heading) + 1, value=value)
    out = BytesIO()
    wb.save(out)
    return out.getvalue()


def show_import(body: dict) -> None:
    for a in body["adding"]:
        print(f"     adding: {a['mortgage_name']} ({a['customer_name']}) {a['called_on']} {a['note']!r}")
    for n in body["not_imported"]:
        print(f"     not imported: row {n['row']} {n['mortgage_name']!r} {n['note']!r}: {n['reason']}")
    print(f"     skipped_empty={body['skipped_empty']} skipped_duplicates={body['skipped_duplicates']}")


def upload(data: bytes) -> dict:
    return {"files": {"file": ("call-list.xlsx", data, XLSX)}}


def report(built: Path) -> None:
    ro = Copy(built, "read-only")

    # ------------------------------------------------------------ lesson 1
    print("\n== L1. The Call List on 19 Oct 2026")
    print("   settings:", ro.call("get", "/settings/call-list", quiet=True)[1])
    ro.call_list()
    print("   Every Active Mortgage, and why it is or isn't listed:")
    for mid in (RING, CHAIN, 5, ARJUN_CHAIN, MANGALSUTRA, ANKLET):
        _, m = ro.call("get", f"/mortgages/{mid}", quiet=True)
        ledger = m["ledger"]
        today_interest = [s for s in ledger if s["event"] == "interest" and s["on"] == THE_DAY.isoformat()]
        ltv = m["collateral"] and m["collateral"]["loan_to_value"]
        print(f"     {mid} {m['name']}: months_unpaid={m.get('months_unpaid')} ltv={pct(ltv)}"
              f" accrues_today={bool(today_interest)} dormant={m.get('dormant')}"
              f" outstanding={rs(m['outstanding']['total'])}")
    print("   Meera's chain's interest steps and payments since Mar 2026:")
    _, m = ro.call("get", f"/mortgages/{CHAIN}", quiet=True)
    for s in m["ledger"]:
        if s["on"] >= "2026-03-01" and s["event"] in ("interest", "payment"):
            print(f"     {s['on']} {s['event']} {rs(s['amount'])} paid_ahead={rs(s.get('paid_ahead'))}")
    print("   the ring's Call Notes:", ro.call("get", f"/mortgages/{RING}/call-notes", quiet=True)[1])
    print("   loan_to_value_too_high at the 85% limit:")
    s85 = CallListSettings(months_unpaid=3, loan_to_value_pct=85)
    for ratio in (0.84, 0.85, 0.8501, None):
        print(f"     {ratio} -> {loan_to_value_too_high(ratio, s85)}")
    print("   Months Unpaid of every Active Mortgage, from the real months_unpaid:")
    engine = create_engine(f"sqlite:///{ro.db}")
    with engine.connect() as conn:
        rows = conn.execute(select(mortgage_table).where(mortgage_table.c.status == "active")).mappings().all()
        replayed = replays(conn, rows)
        for row in rows:
            r = replayed[row["id"]]
            print(f"     {row['id']} {row['name']}: months_unpaid={months_unpaid(r.ledger(THE_DAY))}"
                  f" dormant={r.dormant(THE_DAY)}")
        print("   Meera's chain: Months Unpaid after each 10th, 2026:")
        steps = replayed[CHAIN].ledger(THE_DAY)
        for month in range(3, 11):
            on = date(2026, month, 10).isoformat()
            print(f"     {on}: {months_unpaid([s for s in steps if s.on.isoformat() <= on])}")
    print("   Sorted by outstanding, descending:")
    ro.call_list(sort="outstanding", descending=True)

    print("   (a) the Months Unpaid limit lowered to 1, on a copy:")
    lim = Copy(built, "l1-limit")
    lim.call("put", "/settings/call-list", json={"months_unpaid": 1, "loan_to_value_pct": 85})
    lim.call_list()

    print("   (b) Arjun's chain called too, on a copy:")
    called = Copy(built, "l1-called")
    called.call("post", f"/mortgages/{ARJUN_CHAIN}/call-notes", json={"note": "Said he'd come Saturday"})
    called.call_list()

    print("   (c) the ring set by hand to Rs 1,00,000 (LTV 85.18%), and Rs 1,01,000:")
    for value in (100_000, 100_217, 101_000):
        _, p = ro.call("post", f"/mortgages/{RING}/collateral-preview", quiet=True, json={"value": value * RUPEE})
        print(f"     {value:,}: after ltv={p['after']['loan_to_value']:.4%} listed_before={p['listed_before']}"
              f" listed_after={p['listed_after']}")
    print("   (d) the anklet is Dormant on 19 Oct; its next accrual:")
    _, m = ro.call("get", f"/mortgages/{ANKLET}", quiet=True)
    print(f"     start {m['start_date']}, outstanding {rs(m['outstanding']['total'])}")
    print("   (e) the Call List on 21 Oct (Sunita's mangalsutra accrues):")
    later = Copy(built, "l1-21oct", day=date(2026, 10, 21))
    later.call_list()
    print("   (f) the Call List on 10 Nov (Meera's chain accrues):")
    nov = Copy(built, "l1-10nov", day=date(2026, 11, 10))
    nov.call_list()

    # ------------------------------------------------------------ lesson 2
    print("\n== L2. Call Notes and Call Sheets")
    l2 = Copy(built, "l2")
    l2.sql("SELECT id, mortgage_id, called_on, note, created_at FROM call_note")
    r = l2.api.get("/api/call-list/export.xlsx")
    print(f"   GET /call-list/export.xlsx -> {r.status_code} {r.headers['content-type']}"
          f" {r.headers['content-disposition']}")
    exported = r.content
    for i, row in enumerate(sheet_rows(exported), start=1):
        print(f"     row {i}: {row}")
    wb = load_workbook(BytesIO(exported))
    sh = wb.active
    print("   sheet title:", sh.title, " freeze:", sh.freeze_panes,
          " Outstanding format:", sh["G2"].number_format, " Called on:", sh["J2"].value, sh["J2"].number_format)
    pdf = l2.api.get("/api/call-list/export.pdf")
    print(f"   GET /call-list/export.pdf -> {pdf.status_code} {pdf.headers['content-type']} {len(pdf.content)} bytes")
    names = [row[2] for row in sheet_rows(exported)]
    chain_row = names.index("2026-Arjun-GoldChain") + 1
    filled = workbook_with(exported, {(chain_row, "Call Note"): "Will pay ₹5,000 on Saturday"})
    print("   Preview the import:")
    _, body = l2.call("post", "/call-list/import-preview", **upload(filled))
    show_import(body)
    l2.sql("SELECT count(*) AS call_notes FROM call_note")
    print("   Import it:")
    _, body = l2.call("post", "/call-list/import", **upload(filled))
    show_import(body)
    l2.sql("SELECT id, mortgage_id, called_on, note FROM call_note")
    print("   Import it again:")
    _, body = l2.call("post", "/call-list/import", **upload(filled))
    show_import(body)
    l2.sql("SELECT count(*) AS call_notes FROM call_note")
    print("   The Call List after the import:")
    l2.call_list()

    print("   Rows an import leaves out (preview on the read-only copy):")
    ring_row = names.index("2025-Arjun-GoldRingRuby") + 1
    odd = workbook_with(exported, {
        (chain_row, "Call Note"): "Back from Pune next week",
        (chain_row, "Called on"): date(2026, 10, 25),
        (ring_row, "Call Note"): "Will pay after Diwali",
        (4, "Mortgage Name"): "2026-Kavita-GoldCoin", (4, "Call Note"): "Collected the coin", (4, "Called on"): "18 Oct 2026",
        (5, "Mortgage Name"): "2026-Kavita-Coin", (5, "Call Note"): "Wrong name",
        (6, "Mortgage Name"): "2026-Sunita-Mangalsutra", (6, "Call Note"): "Rang before lending",
        (6, "Called on"): "20 Sep 2026",
        (7, "Mortgage Name"): "2026-Sunita-Mangalsutra", (7, "Call Note"): "Spoke to her",
        (7, "Called on"): "next Tuesday",
        (8, "Mortgage Name"): None, (8, "Call Note"): "Who was this?",
        (9, "Mortgage Name"): "2026-Kavita-SilverGoldAnklet",
        (9, "Call Note"): "  ", (9, "Called on"): "19/10/2026",
        (10, "Mortgage Name"): "2026-kavita-silvergoldanklet", (10, "Call Note"): "Anklet still with us",
        (10, "Called on"): "19/10/2026",
    })
    for i, row in enumerate(sheet_rows(odd), start=1):
        print(f"     row {i}: {row[2]!r} | {row[9]!r} | {row[10]!r}")
    _, body = ro.call("post", "/call-list/import-preview", **upload(odd))
    show_import(body)
    print("   Not an Excel file:")
    ro.call("post", "/call-list/import-preview", files={"file": ("x.csv", b"a,b\n", "text/csv")})

    print("   One at a time:")
    one = Copy(built, "l2-one")
    s, n1 = one.call("post", f"/mortgages/{ARJUN_CHAIN}/call-notes", json={"note": "  Will pay ₹5,000 on Saturday "})
    print("    ", s, n1)
    s, n2 = one.call("post", f"/mortgages/{ARJUN_CHAIN}/call-notes", json={"note": "Will pay ₹5,000 on Saturday"})
    print("    ", s, n2, "same id:", n1["id"] == n2["id"])
    one.call("post", f"/mortgages/{ARJUN_CHAIN}/call-notes", json={"note": "   "})
    one.call("post", f"/mortgages/{COIN}/call-notes", json={"note": "Collected the coin"})
    one.call("post", f"/mortgages/{ANKLET}/call-notes", json={"note": "Ask about the anklet"})
    one.call("post", "/mortgages/99/call-notes", json={"note": "x"})
    print("   ", one.call("get", f"/mortgages/{ARJUN_CHAIN}/call-notes", quiet=True)[1])
    one.sql("SELECT count(*) AS history_rows FROM audit_entry")
    ro.sql("SELECT count(*) AS history_rows FROM audit_entry")

    # ------------------------------------------------------------ lesson 3
    print("\n== L3. The Reminder queue")
    l3 = Copy(built, "l3")
    print("   settings:", {k: v for k, v in l3.call("get", "/settings/messages", quiet=True)[1].items()
                            if not k.endswith("template")})
    l3.by_status()
    l3.unsent()
    l3.sql("SELECT id, customer_id, accrues_on, created_on, status, approved, sent_at, length(message) AS msg_len"
           " FROM reminder WHERE status != 'sent'")
    l3.sql("SELECT count(*) AS sent, min(accrues_on), max(accrues_on) FROM reminder WHERE status='sent'")
    l3.sql("SELECT count(*) AS reminder_mortgage_rows FROM reminder_mortgage")
    l3.sql("SELECT accrues_on, count(*) FROM reminder GROUP BY accrues_on HAVING count(*) > 1")
    _, dash = l3.call("get", "/dashboard", quiet=True)
    print("   Dashboard reminders:", {k: v for k, v in dash.items() if "reminder" in k.lower()})
    print("   Sync again by reading twice: unsent unchanged?")
    l3.unsent()
    print("   Coming Accrual Dates of each Active Mortgage, 19–21 Oct:")
    for mid in (RING, CHAIN, 5, ARJUN_CHAIN, MANGALSUTRA, ANKLET):
        _, m = l3.call("get", f"/mortgages/{mid}", quiet=True)
        print(f"     {mid} {m['name']} starts {m['start_date']}")

    print("   Turn approve first off:")
    msgs = l3.call("get", "/settings/messages", quiet=True)[1]
    l3.call("put", "/settings/messages", json={**msgs, "reminder_approve_first": False})
    l3.unsent()
    l3.sql("SELECT id, status, approved FROM reminder WHERE status != 'sent'")
    print("   And on again:")
    l3.call("put", "/settings/messages", json={**msgs, "reminder_approve_first": True})
    l3.unsent()

    print("   (a) Approve, then turn approve-first off and on again:")
    ap = Copy(built, "l3-approve")
    sunita = [n for n in ap.reminders() if n["status"] == "awaiting_approval"][0]
    ap.call("post", f"/reminders/{sunita['id']}/approve")
    ap.sql("SELECT id, status, approved FROM reminder WHERE status != 'sent'")
    m2 = ap.call("get", "/settings/messages", quiet=True)[1]
    ap.call("put", "/settings/messages", json={**m2, "reminder_days_before": 3})
    ap.sql("SELECT id, status, approved FROM reminder WHERE status != 'sent'")
    ap.call("put", "/settings/messages", json={**m2, "reminder_approve_first": False})
    ap.call("put", "/settings/messages", json={**m2, "reminder_approve_first": True})
    ap.sql("SELECT id, status, approved FROM reminder WHERE status != 'sent'")

    print("   (b) Days ahead 2 -> 7, then back to 2:")
    ahead = Copy(built, "l3-ahead")
    m3 = ahead.call("get", "/settings/messages", quiet=True)[1]
    ahead.call("put", "/settings/messages", json={**m3, "reminder_days_before": 7})
    ahead.unsent()
    ahead.call("put", "/settings/messages", json={**m3, "reminder_days_before": 2})
    ahead.unsent()
    ahead.sql("SELECT max(id) AS highest_reminder_id FROM reminder")

    print("   (c) The app off from 19 Oct, opened again on 24 Oct (days ahead 2):")
    off = Copy(built, "l3-off", day=date(2026, 10, 24))
    off.unsent()
    off.sql("SELECT id, customer_id, accrues_on, created_on, status FROM reminder WHERE created_on >= '2026-10-19'")
    print("   (c2) ...and on 23 Oct:")
    off2 = Copy(built, "l3-off2", day=date(2026, 10, 23))
    off2.unsent()
    print("   (c3) ...and on 26 Oct, the day after the bangles' 25 Oct:")
    off3 = Copy(built, "l3-off3", day=date(2026, 10, 26))
    off3.unsent()
    print("   Sunita's 21 Oct Reminder, read on 24 Oct:")
    print("\n".join("     | " + line for line in off.reminders("awaiting_approval")[0]["message"].splitlines()))

    print("   (d) the daily run on 20 Oct, through any /api/ request first:")
    d20 = Copy(built, "l3-20oct", day=date(2026, 10, 20))
    d20.call("get", "/payment-methods", quiet=True)
    d20.sql("SELECT id, customer_id, accrues_on, created_on, status FROM reminder WHERE created_on >= '2026-10-19'")

    print("   (e) the anklet (Dormant) accrues on 1 Nov; days ahead 14 on 19 Oct:")
    dorm = Copy(built, "l3-dormant")
    m4 = dorm.call("get", "/settings/messages", quiet=True)[1]
    dorm.call("put", "/settings/messages", json={**m4, "reminder_days_before": 14})
    dorm.unsent()

    # ------------------------------------------------------------ lesson 4
    print("\n== L4. A Reminder's life")
    l4 = Copy(built, "l4")
    [awaiting] = l4.reminders("awaiting_approval")
    nid = awaiting["id"]
    print(f"   Sunita's Reminder #{nid}: {awaiting['status']}, phones {awaiting['phones']},"
          f" mortgages {awaiting['mortgages']}")
    print("   message:\n" + "\n".join("     | " + line for line in awaiting["message"].splitlines()))
    l4.sql(f"SELECT id, status, approved, message, sent_at FROM reminder WHERE id={nid}")
    l4.call("post", f"/reminders/{nid}/sent")
    s, after = l4.call("post", f"/reminders/{nid}/approve")
    print("    ", after["status"])
    l4.sql(f"SELECT id, status, approved, message, sent_at FROM reminder WHERE id={nid}")
    l4.call("post", f"/reminders/{nid}/approve")
    s, sent = l4.call("post", f"/reminders/{nid}/sent")
    print("    ", sent["status"], sent["sent_at"])
    l4.sql(f"SELECT id, status, approved, length(message) AS msg_len, sent_at FROM reminder WHERE id={nid}")
    l4.sql(f"SELECT * FROM reminder_mortgage WHERE reminder_id={nid}")
    l4.call("post", f"/reminders/{nid}/sent")
    l4.call("post", f"/reminders/{nid}/skip")
    l4.call("post", "/reminders/999/approve")
    print("   Now a Payment of Rs 5,000 on the mangalsutra, 19 Oct:")
    l4.call("post", "/payments", json={"customer_id": 7, "paid_on": THE_DAY.isoformat(), "method": "upi",
                                         "amount": 5_000 * RUPEE,
                                         "allocations": [{"mortgage_id": MANGALSUTRA, "amount": 5_000 * RUPEE}]})
    [still] = [n for n in l4.reminders() if n["id"] == nid]
    print("   the sent message unchanged:", still["message"] == awaiting["message"])
    _, m9 = l4.call("get", f"/mortgages/{MANGALSUTRA}", quiet=True)
    print("   mangalsutra outstanding now:", rs(m9["outstanding"]["total"]))
    print("   the dashboard:", {k: v for k, v in l4.call("get", "/dashboard", quiet=True)[1].items()
                                 if "reminder" in k.lower()})

    print("   The same Payment before the Reminder is sent, on a copy:")
    pay = Copy(built, "l4-pay-first")
    pay.call("post", "/payments", json={"customer_id": 7, "paid_on": THE_DAY.isoformat(), "method": "upi",
                                          "amount": 5_000 * RUPEE,
                                          "allocations": [{"mortgage_id": MANGALSUTRA, "amount": 5_000 * RUPEE}]})
    [reworded] = pay.reminders("awaiting_approval")
    print("   message:\n" + "\n".join("     | " + line for line in reworded["message"].splitlines()))

    print("   Skip it instead, on a copy:")
    sk = Copy(built, "l4-skip")
    sk.call("post", f"/reminders/{nid}/skip")
    sk.sql(f"SELECT id, status, approved, length(message) AS msg_len, sent_at FROM reminder WHERE id={nid}")
    sk.sql(f"SELECT * FROM reminder_mortgage WHERE reminder_id={nid}")
    sk.call("post", f"/reminders/{nid}/approve")

    print("   Nothing left to say: Sunita's mangalsutra Redeemed before the Reminder is sent:")
    red = Copy(built, "l4-redeemed")
    red.call("post", f"/mortgages/{MANGALSUTRA}/redeem", json={"redeemed_on": THE_DAY.isoformat(), "method": "upi"})
    [n] = [n for n in red.reminders() if n["id"] == nid]
    print(f"     #{nid} {n['status']} message={n['message']!r} mortgages={n['mortgages']}")
    print("     dashboard:", {k: v for k, v in red.call("get", "/dashboard", quiet=True)[1].items()
                               if "reminder" in k.lower()})
    red.call("post", f"/reminders/{nid}/approve")
    red.call("post", f"/reminders/{nid}/sent")
    s, n = red.call("post", f"/reminders/{nid}/skip")
    print("    ", n["status"], repr(n["message"]))

    print("   A template edit before sending rewords; after sending doesn't:")
    tpl = Copy(built, "l4-template")
    m5 = tpl.call("get", "/settings/messages", quiet=True)[1]
    tpl.call("put", "/settings/messages", json={**m5, "reminder_template": "Hello {customer_name}: {interest} on {date}."})
    print("    ", repr(tpl.reminders("awaiting_approval")[0]["message"]))
    one_sent = tpl.reminders("sent")[-1]
    print(f"     a sent Reminder (#{one_sent['id']}) still starts:", repr(one_sent["message"][:40]))

    # ------------------------------------------------------------ lesson 5
    print("\n== L5. Messages")
    print("   Sunita's message, with its characters made visible:")
    for line in awaiting["message"].splitlines():
        print(f"     [{len(line):2}] {line!r}")
    print("   The default templates:")
    print(repr(MessageSettings().reminder_template))
    print(repr(MessageSettings().receipt_template))
    print("   A two-card Reminder: Meera given a second Mortgage from 25 Sep, days ahead 7, on a copy:")
    two = Copy(built, "l5-two-cards")
    two.call("post", "/mortgages", json={
        "customer_id": 1, "start_date": "2026-09-25", "amount_lent": 20_000 * RUPEE,
        "description": "Gold earrings", "gross_weight_mg": 5_500, "net_weight_mg": 5_000,
        "purity_karat": 22, "lent_through": "cash", "terms": None})
    m8 = two.call("get", "/settings/messages", quiet=True)[1]
    two.call("put", "/settings/messages", json={**m8, "reminder_days_before": 7})
    [meera] = [n for n in two.reminders("awaiting_approval") if n["customer"]["id"] == 1]
    print(f"     #{meera['id']} accrues {meera['accrues_on']} mortgages={[m['name'] for m in meera['mortgages']]}")
    for line in meera["message"].splitlines():
        print(f"     [{len(line):2}] {line}")
    print("   A card that must widen (reminder_text called directly, amounts made up):")
    big = reminder_text("{mortgages}", ReminderMessage(customer_name="x", accrues_on=date(2026, 11, 10), lines=[
        ReminderLine(description="Necklace", interest=12_34_567 * RUPEE, owed_after=1_23_45_678 * RUPEE)]))
    for line in big.splitlines():
        print(f"     [{len(line):2}] {line}")
    print("   The WhatsApp link, from frontend/src/messaging.ts run by Node with window.open stubbed:")
    probe = built.parent / "probe.mjs"
    probe.write_text(
        "const opened = []\n"
        "globalThis.window = { open: (url, target, features) => opened.push([url, target, features]) }\n"
        f"const {{ sender }} = await import({str(REPO / 'frontend' / 'src' / 'messaging.ts')!r})\n"
        "const [phone, text] = JSON.parse(process.argv[2])\n"
        "sender.send(phone, text)\n"
        "sender.chat(phone)\n"
        "for (const o of opened) console.log(JSON.stringify(o))\n"
    )
    out = subprocess.run(["node", str(probe), json.dumps(["9860067890", awaiting["message"]])],
                         capture_output=True, text=True)
    print("    ", out.stdout.strip().replace("\n", "\n      "), out.stderr.strip()[-300:])
    print("   Receipt 26 (Kavita's coin, Redeemed):")
    _, rec = ro.call("get", "/payments/26/receipt", quiet=True)
    for line in rec["text"].splitlines():
        print(f"     | {line}")
    print("   unknown_placeholders and fill:")
    for t in ("Namaste {name}", "Pay { amount } by {date", "{interest} on {date}", "{customer_name}{{x}}"):
        print(f"     {t!r}: unknown={unknown_placeholders(t, REMINDER_PLACEHOLDERS)}"
              f" fill={fill(t, {'date': '21 Oct 2026', 'interest': '₹700'})!r}")
    print("   template_refusal:", template_refusal(MessageSettings(reminder_template="Namaste {name}")))
    l5 = Copy(built, "l5")
    m6 = l5.call("get", "/settings/messages", quiet=True)[1]
    for t in ("Namaste {name}, {interest} will be added on {date}.",
              "Namaste {customer_name}, { interest } on {date",
              "Namaste {customer_name}, {interest} will be added on {date}.\n\n{mortgages}"):
        l5.call("put", "/settings/messages", json={**m6, "reminder_template": t})
    print("   Sunita's Reminder after the accepted template:")
    print("\n".join("     | " + line for line in l5.reminders("awaiting_approval")[0]["message"].splitlines()))
    l5.call("put", "/settings/messages", json={**m6, "receipt_template": "Paid {amount}, owed {interest}"})
    print("   placeholders:", l5.call("get", "/settings/messages/placeholders", quiet=True)[1])
    l5.call("put", "/settings/messages", json={**m6, "reminder_template": ""})
    l5.call("put", "/settings/messages", json={**m6, "reminder_days_before": 29})

    # ------------------------------------------------------------ check yourself
    print("\n== 99. Check yourself")
    print("   Arjun's chain on 19 Nov, with no Payments:")
    q = Copy(built, "q-19nov", day=date(2026, 11, 19))
    q.call_list()
    print("   Sunita's reminder on 20 Oct when the Lender changes days ahead to 1 (on 19 Oct):")
    q2 = Copy(built, "q-1day")
    m7 = q2.call("get", "/settings/messages", quiet=True)[1]
    q2.call("put", "/settings/messages", json={**m7, "reminder_days_before": 1})
    q2.unsent()
    print("   Receipt template with {total_owed} and {reference}: ")
    print("    ", template_refusal(MessageSettings(receipt_template="{reference} {total_owed}")))
    print("    ", template_refusal(MessageSettings(reminder_template="{reference} {total_owed}")))


if __name__ == "__main__":
    main()
