"""Checks every figure and message chapter 006 shows, against the real change, Preview
and History code.

For the course's editors. Builds the sample book once in a temporary folder (never the
Lender's data), then works on fresh copies of its database through the real API, held on
19 Oct 2026: one copy that is only read or Previewed, and one per lesson that saves a
change, so no change leaks into another lesson's figures.

    cd backend && uv run python ../Documentation/onboarding/006-changes-and-previews/scripts/run_throughs.py

Amounts print in rupees (the code works in paise). Each section is headed with the
lesson that quotes it (L1–L5, 99).
"""

import shutil
import sys
import tempfile
from datetime import date, datetime, time
from pathlib import Path

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select

REPO = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(REPO / "docs" / "sample-book"))

import book  # noqa: E402

from mortgage_backend.lending.replay import MortgageReplay, replay  # noqa: E402
from mortgage_backend.main import create_app  # noqa: E402
from mortgage_backend.platform.db import audit_entry_table, term_change_table  # noqa: E402

THE_DAY = book.THE_DAY
RUPEE = 100
RING, CHAIN, COIN, NECKLACE, BANGLES, NOSERING, EARRINGS, ARJUNCHAIN, MANGALSUTRA, ANKLET = range(1, 11)
MEERA = 1
EDIT_FIELDS = ("name", "start_date", "amount_lent", "description", "gross_weight_mg",
               "net_weight_mg", "purity_karat", "lent_through")


def rs(paise: int | None) -> str:
    if paise is None:
        return "None"
    return f"{paise / RUPEE:,.2f}".removesuffix(".00")


class Copy:
    """A fresh copy of the built book, served through the real app on 19 Oct 2026."""

    def __init__(self, built: Path, name: str) -> None:
        self.folder = built.parent / name
        (self.folder / "data").mkdir(parents=True)
        shutil.copy(built, self.folder / "data" / "mortgage.db")
        self.url = f"sqlite:///{self.folder / 'data' / 'mortgage.db'}"
        app = create_app(self.url, today=lambda: THE_DAY,
                         now=lambda: datetime.combine(THE_DAY, time(11, 0)),
                         backup_dir=self.folder / "backups")
        self.api = TestClient(app)
        self.api.__enter__()

    def call(self, method: str, path: str, **kw):
        r = getattr(self.api, method)("/api" + path, **kw)
        body = r.json() if r.content else None
        detail = body.get("detail") if isinstance(body, dict) else None
        print(f"   {method.upper()} {path} -> {r.status_code}" + (f": {detail}" if detail else ""))
        return r.status_code, body

    def history(self, path: str, limit: int | None = None, only=None) -> None:
        _, entries = self.call("get", path)
        shown = [e for e in entries if only is None or only(e)]
        for e in shown[:limit]:
            print(f"     #{e['id']:<3} {e['at'][:16]} {e['entity']:8} {e['entity_id']:>3} {e['action']:20}"
                  f" {e['field'] or '-':18} {e['old_value'] or '-':>26} -> {e['new_value'] or '-':<34}"
                  f" note={e['note']!r} name={e['mortgage_name']!r}")
        print(f"     ({len(entries)} entries)")

    def audit_count(self) -> int:
        with create_engine(self.url).connect() as conn:
            return len(conn.execute(select(audit_entry_table.c.id)).all())

    def edit_body(self, mortgage_id: int, **overrides) -> dict:
        _, m = self.call("get", f"/mortgages/{mortgage_id}")
        return {**{k: m[k] for k in EDIT_FIELDS}, **overrides}


def preview_lines(body) -> None:
    for m in body["mortgages"]:
        b, a = m["before"], m["after"]
        kind = lambda side: side["closure"]["kind"] if side["closure"] else "active"
        print(f"     {m['mortgage_name']}: {kind(b)} owes {rs(b['outstanding'])}"
              f" -> {kind(a)} owes {rs(a['outstanding'])}")
        for months in (0, 3, 6, 12):
            pts = lambda side: next((rs(p["outstanding"]) for p in side["points"] if p["months"] == months), "-")
            print(f"       Projection at {months:>2} months: {pts(b):>10} -> {pts(a):>10}")
        tcs = lambda side: [(c["on"], c["terms"]["monthly_rate_bps"]) for c in side["term_changes"]]
        print("       coming term_changes:", tcs(b), "->", tcs(a))
        if a["closure"]:
            c = a["closure"]
            print("       after.closure:", {k: rs(v) if isinstance(v, int) and not k.endswith(("_id", "_days")) else v
                                           for k, v in c.items()})
        for c in m["ledger_changes"]:
            side = lambda s: (f"{rs(s['amount'])} P={rs(s['principal'])} unpaid={rs(s['unpaid_interest'])}"
                              f" pid={s['payment_id']}") if s else "None"
            print(f"       ledger change {c['on']} {c['event']:16} before: {side(c['before'])}"
                  f"   after: {side(c['after'])}")
    print("     cash:", [rs(c) for c in body["cash"]])


def main() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        folder = Path(tmp) / "book"
        book.write(folder)
        report(folder / "data" / "mortgage.db")


def report(built: Path) -> None:
    ro = Copy(built, "read-only")

    # ------------------------------------------------------------ lesson 1
    print("\n== L1. One door: the bangles' Term Change")
    _, bangles = ro.call("get", f"/mortgages/{BANGLES}")
    print("   bangles terms:", bangles["terms"], "term_changes:", bangles["term_changes"])
    with create_engine(ro.url).connect() as conn:
        for row in conn.execute(select(term_change_table)).mappings():
            print("   term_change row:", dict(row))
    print("   refused attempts (saved nothing):")
    before = ro.audit_count()
    ro.call("post", f"/mortgages/{BANGLES}/term-changes", json={"effective_on": "2026-11-01", "monthly_rate_bps": 100})
    ro.call("post", f"/mortgages/{BANGLES}/term-changes", json={"effective_on": "2026-10-25", "monthly_rate_bps": 100})
    ro.call("post", f"/mortgages/{BANGLES}/term-changes", json={"effective_on": "2026-11-25", "monthly_rate_bps": 150})
    ro.call("post", f"/mortgages/{BANGLES}/term-changes", json={"effective_on": "2026-09-25", "monthly_rate_bps": 100})
    ro.call("post", f"/mortgages/{COIN}/term-changes", json={"monthly_rate_bps": 100})
    ro.call("post", f"/mortgages/{BANGLES}/term-changes", json={"effective_on": "2026-11-25", "monthly_rate_bps": 0})
    print("   History rows before/after the refusals:", before, ro.audit_count())
    print("   the same through the Preview twin:")
    ro.call("post", f"/mortgages/{BANGLES}/term-changes/preview", json={"effective_on": "2026-11-01", "monthly_rate_bps": 100})
    ro.call("post", f"/mortgages/{BANGLES}/term-changes/preview", json={"effective_on": "2026-10-25", "monthly_rate_bps": 100})

    l1 = Copy(built, "l1-saved")
    print("   a Term Change that saves (on its own copy): 1.25% from 25 Nov")
    code, m = l1.call("post", f"/mortgages/{BANGLES}/term-changes", json={"effective_on": "2026-11-25", "monthly_rate_bps": 125})
    print("   term_changes now:", m["term_changes"])
    print("   with no effective_on (the next Accrual Date, 25 Oct, already taken):")
    l1.call("post", f"/mortgages/{BANGLES}/term-changes", json={"interest_mode": "simple"})

    # ------------------------------------------------------------ lesson 2
    print("\n== L2. The check: lower the chain's Principal to ₹1,000")
    before = ro.audit_count()
    ro.call("put", f"/mortgages/{CHAIN}", json=ro.edit_body(CHAIN, amount_lent=1_000 * RUPEE))
    ro.call("post", f"/mortgages/{CHAIN}/edit-preview", json=ro.edit_body(CHAIN, amount_lent=1_000 * RUPEE))
    print("   History rows before/after:", before, ro.audit_count())
    _, chain = ro.call("get", f"/mortgages/{CHAIN}")
    print("   chain still lent:", rs(chain["amount_lent"]))
    print("   the replay check_replays makes, lent ₹1,000: the Ledger up to 10 Dec, before its Payment")
    with create_engine(ro.url).connect() as conn:
        real = replay(conn, CHAIN)
        lent_1000 = MortgageReplay({**real.row, "amount_lent": 1_000 * RUPEE}, [], real.term_changes)
        for s in lent_1000.ledger(date(2025, 12, 10)):
            print(f"     {s.on} {s.event:16} {rs(s.amount):>6} P={rs(s.principal)} unpaid={rs(s.unpaid_interest)}"
                  + (f" days={s.interest_to_date_days}" if s.event == "interest_to_date" else ""))
        print("     owed on 10 Dec:", rs(lent_1000.outstanding(date(2025, 12, 10)).total),
              "; first Payment:", min((a.on, rs(a.amount)) for a in real.allocations))
    print("   other Principals, to find the line:")
    for lent in (10_000, 50_000):
        ro.call("post", f"/mortgages/{CHAIN}/edit-preview", json=ro.edit_body(CHAIN, amount_lent=lent * RUPEE))
    print("   an edit the early checks refuse (start date after the first Payment):")
    ro.call("put", f"/mortgages/{CHAIN}", json=ro.edit_body(CHAIN, start_date="2025-12-20"))
    ro.call("put", f"/mortgages/{CHAIN}", json=ro.edit_body(CHAIN, name="2026-Meera-PairBangles"))
    print("   several Mortgages: a refusal names which (Waive-all Preview, chain paid in full):")
    _, q = ro.call("get", f"/mortgages/{CHAIN}/outstanding-on-closure", params={"on": "2026-10-19"})
    ro.call("post", "/closures/waive-preview", json={
        "waived_on": "2026-10-19", "method": "cash", "note": "",
        "mortgages": [{"mortgage_id": BANGLES, "amount_paid": 0}, {"mortgage_id": CHAIN, "amount_paid": q["total"]}]})
    ro.call("post", "/closures/redeem-preview", json={
        "redeemed_on": "2026-10-19", "method": "cash", "mortgage_ids": [CHAIN, COIN]})
    print("   a Void can't trip the check: void Meera's 10 Sep Payment (id 23) on a copy")
    ro.call("post", "/payments/23/void-preview")
    _, vp = ro.call("post", "/payments/23/void-preview")
    preview_lines(vp)
    print("   Voiding the coin's Final Payment (26) directly:")
    ro.call("post", "/payments/26/void", json={"reason": "test"})
    ro.call("post", "/payments/26/void-preview")
    print("   Reopen Preview of the coin (calls void_payment for Payment 26):")
    _, rp = ro.call("post", f"/mortgages/{COIN}/reopen-preview")
    preview_lines(rp)

    # ------------------------------------------------------------ lesson 3
    print("\n== L3. History")
    print("   the chain (newest first):")
    ro.history(f"/mortgages/{CHAIN}/history", only=lambda e: e["entity"] == "mortgage")
    ro.history(f"/mortgages/{CHAIN}/history", limit=6)
    print("   the bangles:")
    ro.history(f"/mortgages/{BANGLES}/history")
    print("   Meera's customer history (count, first 8):")
    ro.history(f"/customers/{MEERA}/history", limit=8)
    print("   the coin (Redeemed):")
    ro.history(f"/mortgages/{COIN}/history", limit=4)
    print("   the earrings (Forfeited):")
    ro.history(f"/mortgages/{EARRINGS}/history", limit=3)
    print("   the nose ring (Waived):")
    ro.history(f"/mortgages/{NOSERING}/history", limit=3)

    l3 = Copy(built, "l3-saved")
    print("   on a copy: reopen the coin, then rename the chain, then read History")
    l3.call("post", f"/mortgages/{COIN}/reopen", json={"reason": "Redeemed by mistake: Kavita still has to pay"})
    l3.history(f"/mortgages/{COIN}/history", limit=4)
    l3.call("put", f"/mortgages/{CHAIN}", json=l3.edit_body(CHAIN, name="2025-Meera-ChainWithPendant"))
    l3.history(f"/mortgages/{CHAIN}/history", only=lambda e: e["entity"] == "mortgage")
    print("   an edit that changes nothing:")
    n = l3.audit_count()
    l3.call("put", f"/mortgages/{CHAIN}", json=l3.edit_body(CHAIN))
    print("   History rows before/after:", n, l3.audit_count())

    # ------------------------------------------------------------ lesson 4
    print("\n== L4. Previews")
    tc_id = bangles["term_changes"][0]["id"]
    print(f"   remove-preview of the bangles' Term Change (id {tc_id}):")
    _, rm = ro.call("post", f"/mortgages/{BANGLES}/term-changes/{tc_id}/remove-preview")
    preview_lines(rm)
    print("   Preview a UPI Payment of exactly the chain's Outstanding on 19 Oct:")
    print("   quote total:", rs(q["total"]))
    pay = {"customer_id": MEERA, "paid_on": "2026-10-19", "amount": q["total"], "method": "upi",
           "reference": None, "allocations": [{"mortgage_id": CHAIN, "amount": q["total"]}]}
    _, pp = ro.call("post", "/payments/preview", json=pay)
    preview_lines(pp)
    print("   a rupee less:")
    _, pp1 = ro.call("post", "/payments/preview", json={**pay, "amount": q["total"] - RUPEE,
                     "allocations": [{"mortgage_id": CHAIN, "amount": q["total"] - RUPEE}]})
    preview_lines(pp1)
    print("   in cash:")
    _, ppc = ro.call("post", "/payments/preview", json={**pay, "method": "cash"})
    print("     cash:", [rs(c) for c in ppc["cash"]])
    print("   nothing saved:")
    _, chain = ro.call("get", f"/mortgages/{CHAIN}")
    print("     chain status", chain["status"], "History rows", ro.audit_count())
    print("   a refused Preview, and its save, side by side (a rupee too much):")
    over = {**pay, "amount": q["total"] + RUPEE, "allocations": [{"mortgage_id": CHAIN, "amount": q["total"] + RUPEE}]}
    ro.call("post", "/payments/preview", json=over)
    ro.call("post", "/payments", json=over)
    print("   Reopen Preview of Active chain; Void Preview of a Voided Payment (27):")
    ro.call("post", f"/mortgages/{CHAIN}/reopen-preview")
    ro.call("post", "/payments/27/void-preview")

    # ------------------------------------------------------------ lesson 5
    print("\n== L5. Collateral Value: the smallest complete change")
    _, chain = ro.call("get", f"/mortgages/{CHAIN}")
    print("   chain collateral:", chain["collateral"])
    _, cp = ro.call("post", f"/mortgages/{CHAIN}/collateral-preview", json={"value": 90_000 * RUPEE})
    print("   preview:", cp)
    ro.call("put", f"/mortgages/{COIN}/collateral", json={"value": 90_000 * RUPEE})
    ro.call("put", f"/mortgages/{CHAIN}/collateral", json={"value": 0})
    ro.call("post", f"/mortgages/{COIN}/collateral-preview", json={"value": 90_000 * RUPEE})
    l5 = Copy(built, "l5-saved")
    _, saved = l5.call("put", f"/mortgages/{CHAIN}/collateral", json={"value": 90_000 * RUPEE})
    print("   saved collateral:", saved["collateral"])
    l5.history(f"/mortgages/{CHAIN}/history", limit=1)
    _, cleared = l5.call("put", f"/mortgages/{CHAIN}/collateral", json={"value": None})
    print("   cleared collateral:", cleared["collateral"])
    l5.history(f"/mortgages/{CHAIN}/history", limit=2)

    # ------------------------------------------------------------ check yourself
    print("\n== 99. Check yourself")
    ro.call("post", f"/mortgages/{NOSERING}/term-changes", json={"monthly_rate_bps": 100})
    ro.call("post", f"/mortgages/{BANGLES}/term-changes/{tc_id + 50}/remove-preview")
    ro.call("post", "/payments/23/void", json={"reason": "  "})
    ro.call("post", f"/mortgages/{BANGLES}/term-changes", json={"effective_on": "2026-10-19", "monthly_rate_bps": 100})
    l99 = Copy(built, "l99-saved")
    print("   on a copy: removing the bangles' coming Term Change saves")
    _, b2 = l99.call("delete", f"/mortgages/{BANGLES}/term-changes/{tc_id}")
    print("   bangles' Term Changes now:", b2["term_changes"])
    l99.history(f"/mortgages/{BANGLES}/history", limit=1)


if __name__ == "__main__":
    main()
