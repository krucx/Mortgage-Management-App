"""Checks every figure and message chapter 007 shows, against the real Payment, Void,
Cash Limit and Receipt code.

For the course's editors. Builds the sample book once in a temporary folder (never the
Lender's data), then works on fresh copies of its database through the real API, held on
19 Oct 2026: one copy that is only read or Previewed, and one per change that saves, so
no change leaks into another section's figures.

    cd backend && uv run python ../Documentation/onboarding/007-payments-and-receipts/scripts/run_throughs.py

Amounts print in rupees (the code works in paise). Each section is headed with the
lesson that quotes it (L1–L5, 99).
"""

import shutil
import sqlite3
import sys
import tempfile
from datetime import datetime, time
from pathlib import Path

from fastapi.testclient import TestClient

REPO = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(REPO / "docs" / "sample-book"))

import book  # noqa: E402

from mortgage_backend.main import create_app  # noqa: E402

THE_DAY = book.THE_DAY
RUPEE = 100
RING, CHAIN, COIN, NECKLACE, BANGLES, NOSERING, EARRINGS, ARJUNCHAIN, MANGALSUTRA, ANKLET = range(1, 11)
MEERA, KAVITA = 1, 3
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
        self.db = self.folder / "data" / "mortgage.db"
        shutil.copy(built, self.db)
        app = create_app(f"sqlite:///{self.db}", today=lambda: THE_DAY,
                         now=lambda: datetime.combine(THE_DAY, time(11, 0)),
                         backup_dir=self.folder / "backups")
        self.api = TestClient(app)
        self.api.__enter__()

    def call(self, method: str, path: str, quiet: bool = False, **kw):
        r = getattr(self.api, method)("/api" + path, **kw)
        body = r.json() if r.content else None
        detail = body.get("detail") if isinstance(body, dict) else None
        if isinstance(detail, list):
            detail = "; ".join(d["msg"] for d in detail)
        if not quiet:
            print(f"   {method.upper()} {path} -> {r.status_code}" + (f": {detail}" if detail else ""))
        return r.status_code, body

    def sql(self, query: str) -> None:
        with sqlite3.connect(self.db) as conn:
            cur = conn.execute(query)
            print("     sqlite>", query)
            print("     ", " | ".join(d[0] for d in cur.description))
            for row in cur.fetchall():
                print("     ", " | ".join("" if v is None else str(v) for v in row))

    def payment(self, payment_id: int) -> None:
        _, p = self.call("get", f"/payments/{payment_id}")
        print(f"     Payment {p['id']}: {p['paid_on']} {rs(p['amount'])} {p['method']} ref={p['reference']!r}"
              f" voided_at={p['voided_at']} reason={p['void_reason']!r}  keys={sorted(p)}")
        for a in p["allocations"]:
            print(f"       {a['mortgage_name']:30} {rs(a['amount']):>9}  interest {rs(a['interest_paid']):>7}"
                  f"  Principal {rs(a['principal_paid']):>7}")

    def receipt(self, payment_id: int, text: bool = False) -> None:
        code, r = self.call("get", f"/payments/{payment_id}/receipt")
        if code != 200:
            return
        print(f"     Receipt of {payment_id}: {r['paid_on']} {rs(r['amount'])} {r['method']} ref={r['reference']!r}"
              f" to {r['customer']['name']} phones={r['phones']} total_owed={rs(r['total_owed'])}")
        for line in r["lines"]:
            print(f"       {line['description']:34} (id {line['mortgage_id']}) paid {rs(line['paid']):>9}"
                  f" = {rs(line['interest_paid'])} + {rs(line['principal_paid'])};"
                  f" still owed {rs(line['owed_after'])}; redeemed={line['redeemed']}")
        if text:
            print("       --- text ---")
            for t in r["text"].splitlines():
                print("       |", t)

    def edit_body(self, mortgage_id: int, **overrides) -> dict:
        _, m = self.call("get", f"/mortgages/{mortgage_id}", quiet=True)
        return {**{k: m[k] for k in EDIT_FIELDS}, **overrides}

    def owes(self, mortgage_id: int) -> int:
        _, q = self.call("get", f"/mortgages/{mortgage_id}/outstanding-on-closure",
                         quiet=True, params={"on": THE_DAY.isoformat()})
        return q["total"]


def pay(customer: int, on: str, method: str, *allocations: tuple[int, int], reference=None) -> dict:
    return {"customer_id": customer, "paid_on": on, "method": method, "reference": reference,
            "amount": sum(a for _, a in allocations),
            "allocations": [{"mortgage_id": m, "amount": a} for m, a in allocations]}


def preview_lines(body) -> None:
    for m in body["mortgages"]:
        b, a = m["before"], m["after"]
        kind = lambda side: side["closure"]["kind"] if side["closure"] else "active"
        print(f"     {m['mortgage_name']}: {kind(b)} owes {rs(b['outstanding'])}"
              f" -> {kind(a)} owes {rs(a['outstanding'])}")
        for c in m["ledger_changes"]:
            s = c["after"] or c["before"]
            print(f"       ledger change {c['on']} {c['event']:16} {rs(s['amount'])} pid={s['payment_id']}"
                  f" ({'added' if c['before'] is None else 'removed' if c['after'] is None else 'changed'})")
    print("     cash:", [rs(c) for c in body["cash"]])


def main() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        folder = Path(tmp) / "book"
        book.write(folder)
        report(folder / "data" / "mortgage.db")


def report(built: Path) -> None:
    ro = Copy(built, "read-only")

    # ------------------------------------------------------------ lesson 1
    print("\n== L1. A Payment and its Allocations")
    print("   Meera's 10 Sep Payment (id 23), as stored:")
    ro.sql("SELECT id, customer_id, paid_on, amount, method, reference, voided_at, received_with "
           "FROM payment WHERE id = 23")
    ro.sql("SELECT a.id, a.payment_id, a.mortgage_id, m.name, a.amount FROM allocation a "
           "JOIN mortgage m ON m.id = a.mortgage_id WHERE a.payment_id = 23")
    print("   and as the API gives it (split worked out by replay):")
    ro.payment(23)
    print("   no stored split: the payment table's columns")
    ro.sql("SELECT name FROM pragma_table_info('payment')")
    print("   Kavita's anklet Payments, by id (typed order) and by date:")
    ro.sql("SELECT id, paid_on, amount, method FROM payment WHERE id IN (31, 32, 33) ORDER BY id")
    for pid in (33, 31, 32):
        ro.payment(pid)
    print("   refusals (nothing saves):")
    bad = pay(MEERA, "2026-10-19", "upi", (CHAIN, 1_000 * RUPEE))
    ro.call("post", "/payments", json={**bad, "amount": 2_000 * RUPEE})
    ro.call("post", "/payments", json=pay(MEERA, "2026-10-19", "upi", (CHAIN, 500 * RUPEE), (CHAIN, 500 * RUPEE)))
    ro.call("post", "/payments", json=pay(MEERA, "2026-10-19", "upi"))
    ro.call("post", "/payments", json=pay(MEERA, "2026-10-19", "upi", (CHAIN, 0)))
    ro.call("post", "/payments", json=pay(MEERA, "2026-10-20", "upi", (CHAIN, 1_000 * RUPEE)))
    ro.call("post", "/payments", json=pay(MEERA, "2026-10-19", "upi", (COIN, 1_000 * RUPEE)))
    ro.call("post", "/payments", json=pay(KAVITA, "2026-10-19", "upi", (COIN, 1_000 * RUPEE)))
    ro.call("post", "/payments", json=pay(MEERA, "2025-11-01", "upi", (CHAIN, 1_000 * RUPEE)))
    ro.call("post", "/payments", json=pay(KAVITA, "2026-08-25", "cash", (ANKLET, 1 * RUPEE)))
    ro.call("post", "/payments", json=pay(MEERA, "2026-10-19", "cheque", (CHAIN, 1_000 * RUPEE)))
    ro.sql("SELECT count(*) FROM payment")
    print("   the Payments list for September, and its interest total:")
    _, page = ro.call("get", "/payments", params={"month": "2026-09"})
    for row in page["items"]:
        print(f"     {row['id']:>3} {row['paid_on']} {row['customer']['name']:14} {rs(row['amount']):>8}"
              f" {row['method']:13} {[m['name'] for m in row['mortgages']]} voided={row['voided']}")
    print("     interest_paid:", rs(page["interest_paid"]), " total:", page.get("total"))
    for pid in [row["id"] for row in page["items"]]:
        ro.payment(pid)
    _, page = ro.call("get", "/payments")
    print("     unfiltered interest_paid:", page["interest_paid"])

    # ------------------------------------------------------------ lesson 2
    print("\n== L2. One Payment, several parts")
    chain_owes = ro.owes(CHAIN)
    print("   chain owes today:", rs(chain_owes), " bangles:", rs(ro.owes(BANGLES)))
    mixed = pay(MEERA, "2026-10-19", "upi", (CHAIN, chain_owes), (BANGLES, 1_000 * RUPEE), reference="UPI 5512")
    print("   Preview of chain's whole Outstanding + ₹1,000 on the bangles:")
    _, pv = ro.call("post", "/payments/preview", json=mixed)
    preview_lines(pv)
    l2 = Copy(built, "l2-mixed")
    print("   saved:")
    code, saved = l2.call("post", "/payments", json=mixed)
    print("     returned id:", saved["id"], " amount:", rs(saved["amount"]),
          " allocations:", [(a["mortgage_name"], rs(a["amount"])) for a in saved["allocations"]])
    print("     'received_with' in the response:", "received_with" in saved)
    l2.sql("SELECT id, paid_on, amount, method, reference, received_with FROM payment WHERE id >= 34")
    l2.sql("SELECT id, payment_id, mortgage_id, amount FROM allocation WHERE payment_id >= 34")
    l2.sql("SELECT id, status, closed_on, redemption_payment_id FROM mortgage WHERE id = 2")
    l2.payment(34)
    l2.payment(35)
    l2.receipt(34)
    l2.receipt(35)
    print("   History of the two parts:")
    l2.sql("SELECT id, entity, entity_id, action, field, new_value, note FROM audit_entry WHERE id > 271")
    print("   L4 on the reader's book (after this Payment): ₹25,000 to the bangles, cash then UPI")
    for method in ("cash", "upi"):
        _, pv = l2.call("post", "/payments/preview", json=pay(MEERA, "2026-10-19", method, (BANGLES, 25_000 * RUPEE)))
        preview_lines(pv)
    print("   L3 on the reader's book: Void the chain's Final Payment (35) directly")
    l2.call("post", "/payments/35/void", json={"reason": "test"})
    print("   Reopen the chain: only its Final Payment (35) is Voided")
    l2.call("post", f"/mortgages/{CHAIN}/reopen", json={"reason": "Handed back by mistake"})
    l2.sql("SELECT id, amount, voided_at IS NOT NULL AS voided, received_with FROM payment WHERE id >= 34")
    l2.receipt(34)
    l2.receipt(35)

    print("   every Allocation Redeems: chain + bangles both in full")
    both = pay(MEERA, "2026-10-19", "upi", (CHAIN, chain_owes), (BANGLES, ro.owes(BANGLES)))
    l2b = Copy(built, "l2-both")
    _, saved = l2b.call("post", "/payments", json=both)
    print("     returned id:", saved["id"], [(a["mortgage_name"], rs(a["amount"])) for a in saved["allocations"]])
    l2b.sql("SELECT id, amount, received_with FROM payment WHERE id >= 34")
    l2b.receipt(34)
    print("   only the chain, in full: no received_with at all")
    l2c = Copy(built, "l2-one")
    _, saved = l2c.call("post", "/payments", json=pay(MEERA, "2026-10-19", "upi", (CHAIN, chain_owes)))
    l2c.sql("SELECT id, amount, received_with FROM payment WHERE id >= 34")
    print("   bangles first in the body, then the chain:")
    l2d = Copy(built, "l2-order")
    _, saved = l2d.call("post", "/payments", json=pay(MEERA, "2026-10-19", "upi",
                                                      (BANGLES, 1_000 * RUPEE), (CHAIN, chain_owes)))
    l2d.sql("SELECT id, amount, received_with FROM payment WHERE id >= 34")

    # ------------------------------------------------------------ lesson 3
    print("\n== L3. Voids")
    ro.payment(27)
    ro.payment(28)
    ro.sql("SELECT id, paid_on, amount, voided_at, void_reason FROM payment WHERE id IN (27, 28)")
    ro.receipt(27)
    _, h = ro.call("get", f"/mortgages/{BANGLES}/history")
    for e in h:
        if e["entity"] == "payment" and e["entity_id"] in (27, 28):
            print(f"     #{e['id']} payment {e['entity_id']} {e['action']} {e['field']} "
                  f"{e['old_value']!r} -> {e['new_value']!r} note={e['note']!r}")
    _, page = ro.call("get", "/payments", params={"q": "Meera", "month": "2026-10"})
    print("     Meera, October, voided included:", [(r["id"], rs(r["amount"]), r["voided"]) for r in page["items"]],
          "interest", rs(page["interest_paid"]))
    _, page = ro.call("get", "/payments", params={"q": "Meera", "month": "2026-10", "include_voided": "false"})
    print("     include_voided=false:", [(r["id"], rs(r["amount"]), r["voided"]) for r in page["items"]],
          "interest", rs(page["interest_paid"]))
    print("   refused Voids:")
    ro.call("post", "/payments/27/void", json={"reason": "again"})
    ro.call("post", "/payments/26/void", json={"reason": "wrong"})
    ro.sql("SELECT p.id, p.paid_on, p.amount, a.mortgage_id FROM payment p JOIN allocation a ON a.payment_id = p.id "
           "WHERE a.mortgage_id = 3 ORDER BY p.id")
    ro.call("post", "/payments/6/void", json={"reason": "wrong"})
    ro.call("post", "/payments/23/void", json={"reason": "   "})
    ro.call("post", "/payments/999/void", json={"reason": "x"})
    print("   a correction on a copy: Void Meera's ₹6,000 (28), then enter ₹6,500")
    l3 = Copy(built, "l3-correct")
    _, b = l3.call("get", f"/mortgages/{BANGLES}", quiet=True)
    print("     bangles owe before:", rs(l3.owes(BANGLES)))
    _, voided = l3.call("post", "/payments/28/void", json={"reason": "Was ₹6,500, not ₹6,000"})
    print("     response voided_at:", voided["voided_at"], "split:", [(a["interest_paid"], a["principal_paid"]) for a in voided["allocations"]])
    print("     bangles owe after the Void:", rs(l3.owes(BANGLES)))
    _, new = l3.call("post", "/payments", json=pay(MEERA, "2026-10-10", "cash", (BANGLES, 6_500 * RUPEE)))
    l3.payment(new["id"])
    print("     bangles owe after the new Payment:", rs(l3.owes(BANGLES)))
    print("   Void the ordinary part of the mixed Payment (34); its Final Payment (35) stays:")
    l3b = Copy(built, "l3-part")
    l3b.call("post", "/payments", json=mixed)
    l3b.call("post", "/payments/34/void", json={"reason": "The ₹1,000 was for next month"})
    l3b.sql("SELECT id, amount, voided_at IS NOT NULL AS voided, received_with FROM payment WHERE id >= 34")
    l3b.sql("SELECT id, status, redemption_payment_id FROM mortgage WHERE id = 2")
    l3b.receipt(34)
    l3b.receipt(35)
    print("   Void Preview of 28 (cash sums):")
    _, vp = ro.call("post", "/payments/28/void-preview")
    preview_lines(vp)

    # ------------------------------------------------------------ lesson 4
    print("\n== L4. The Cash Limit")
    ro.call("get", "/settings/cash-limit")
    ro.sql("SELECT * FROM config WHERE key = 'cash_limit'")
    for method in ("cash", "upi"):
        print(f"   ₹25,000 {method} to the chain:")
        _, pv = ro.call("post", "/payments/preview", json=pay(MEERA, "2026-10-19", method, (CHAIN, 25_000 * RUPEE)))
        preview_lines(pv)
    print("   ₹15,000 cash to the chain (below the limit, still listed):")
    _, pv = ro.call("post", "/payments/preview", json=pay(MEERA, "2026-10-19", "cash", (CHAIN, 15_000 * RUPEE)))
    print("     cash:", [rs(c) for c in pv["cash"]])
    print("   ₹12,000 cash: ₹6,000 each to the chain and the bangles (quiz):")
    _, pv = ro.call("post", "/payments/preview", json=pay(MEERA, "2026-10-19", "cash",
                                                           (CHAIN, 6_000 * RUPEE), (BANGLES, 6_000 * RUPEE)))
    print("     cash:", [rs(c) for c in pv["cash"]])
    print("   chain in full + ₹1,000 bangles, in cash: one sum")
    _, pv = ro.call("post", "/payments/preview", json={**mixed, "method": "cash"})
    print("     cash:", [rs(c) for c in pv["cash"]])
    print("   Redeem the chain in cash:")
    _, pv = ro.call("post", f"/mortgages/{CHAIN}/redeem-preview",
                    json={"redeemed_on": "2026-10-19", "method": "cash"})
    print("     cash:", [rs(c) for c in pv["cash"]])
    print("   Waive the chain, ₹50,000 paid in cash:")
    _, pv = ro.call("post", f"/mortgages/{CHAIN}/waive-preview",
                    json={"waived_on": "2026-10-19", "amount_paid": 50_000 * RUPEE, "method": "cash", "note": "x"})
    print("     cash:", [rs(c) for c in pv["cash"]])
    print("   Forfeit the chain, ₹90,000 recovered:")
    _, pv = ro.call("post", f"/mortgages/{CHAIN}/forfeit-preview",
                    json={"forfeited_on": "2026-10-19", "recovered_amount": 90_000 * RUPEE, "note": "x"})
    print("     cash:", [rs(c) for c in pv["cash"]])
    print("   Reopen Farida's nose ring (its ₹30,520 cash Final Payment Voided):")
    _, pv = ro.call("post", f"/mortgages/{NOSERING}/reopen-preview")
    print("     cash:", [rs(c) for c in pv["cash"]])
    print("   Void a cash Payment (Meera's 10 Aug, id 20):")
    ro.sql("SELECT id, paid_on, amount, method FROM payment WHERE customer_id = 1 AND method = 'cash' ORDER BY id")
    _, pv = ro.call("post", "/payments/20/void-preview")
    print("     cash:", [rs(c) for c in pv["cash"]])
    print("   Mortgage edits (Previews):")
    for label, body in [
        ("chain lent ₹90,000 (more, cash)", ro.edit_body(CHAIN, amount_lent=90_000 * RUPEE)),
        ("chain lent ₹80,000 (unchanged, cash)", ro.edit_body(CHAIN, description="Gold chain")),
        ("chain lent ₹70,000 (less, cash)", ro.edit_body(CHAIN, amount_lent=70_000 * RUPEE)),
        ("bangles now lent through cash", ro.edit_body(BANGLES, lent_through="cash")),
    ]:
        _, pv = ro.call("post", f"/mortgages/{body and (CHAIN if 'chain' in label else BANGLES)}/edit-preview", json=body)
        print(f"     {label}: cash", [rs(c) for c in pv["cash"]] if "cash" in pv else pv)
    print("   New Mortgage Preview, ₹30,000 cash:")
    _, nm = ro.call("post", "/mortgages/preview", json={
        "customer_id": MEERA, "start_date": "2026-10-19", "amount_lent": 30_000 * RUPEE,
        "description": "Gold ring", "net_weight_mg": 4000, "gross_weight_mg": 4200, "purity_karat": 22,
        "lent_through": "cash"})
    print("     cash:", [rs(c) for c in nm["cash"]])
    print("   setting the Cash Limit (on a copy):")
    l4 = Copy(built, "l4-limit")
    l4.call("put", "/settings/cash-limit", json={"cash_limit": None})
    l4.sql("SELECT * FROM config WHERE key = 'cash_limit'")
    l4.call("get", "/settings/cash-limit")
    l4.call("put", "/settings/cash-limit", json={"cash_limit": 0})
    l4.call("put", "/settings/cash-limit", json={"cash_limit": 10_000 * RUPEE})
    l4.sql("SELECT * FROM config WHERE key = 'cash_limit'")
    l4.call("post", "/payments", json=pay(MEERA, "2026-10-19", "cash", (CHAIN, 25_000 * RUPEE)))
    print("     (saved, though at or above the limit)")

    # ------------------------------------------------------------ lesson 5
    print("\n== L5. Receipts")
    ro.receipt(23, text=True)
    ro.receipt(26, text=True)
    ro.receipt(29)
    ro.receipt(30, text=True)
    print("   owed_after for Farida's Final Payment, without the special case:")
    from sqlalchemy import create_engine
    from mortgage_backend.lending.replay import replay
    with create_engine(f"sqlite:///{ro.db}").connect() as conn:
        for mid in (CHAIN, BANGLES):
            m = replay(conn, mid)
            print(f"     {m.row['name']} Ledger on 10 Sep (from 10 Aug):")
            for s in m.ledger(book.date(2026, 9, 10)):
                if s.on >= book.date(2026, 8, 10):
                    print(f"       {s.on} {s.event:16} {rs(s.amount):>8} P={rs(s.principal)}"
                          f" unpaid={rs(s.unpaid_interest)} pid={s.payment_id}"
                          + (f" interest_paid={rs(s.interest_paid)}" if s.payment_id else ""))
            print("       owed_after(23, 10 Sep):", rs(m.owed_after(23, book.date(2026, 9, 10))))
        nose = replay(conn, NOSERING)
        print("     owed_after(30, 16 Oct):", rs(nose.owed_after(30, book.date(2026, 10, 16))))
        print("     ledger 16 Oct:")
        for s in nose.ledger(book.date(2026, 10, 16)):
            if s.on >= book.date(2026, 10, 12):
                print(f"       {s.on} {s.event:16} {rs(s.amount):>8} P={rs(s.principal)} unpaid={rs(s.unpaid_interest)}"
                      f" pid={s.payment_id}")
    print("   the 10 Sep Receipt after later Payments (on L2's copy, which paid the chain off):")
    l2.receipt(23)
    print("   ...and after a back-dated Payment before it (₹500 to the chain on 1 Sep):")
    l5 = Copy(built, "l5-backdated")
    l5.call("post", "/payments", json=pay(MEERA, "2026-09-01", "cash", (CHAIN, 500 * RUPEE)))
    l5.receipt(23)
    print("   a second 'Pair of bangles' for Meera, both paid at once:")
    l5b = Copy(built, "l5-alike")
    _, m = l5b.call("post", "/mortgages", json={
        "customer_id": MEERA, "start_date": "2026-10-01", "amount_lent": 40_000 * RUPEE,
        "description": "Pair of bangles", "net_weight_mg": 8000, "gross_weight_mg": 8500, "purity_karat": 22,
        "lent_through": "upi"})
    _, p = l5b.call("post", "/payments", json=pay(MEERA, "2026-10-19", "upi",
                                                  (BANGLES, 2_000 * RUPEE), (m["id"], 500 * RUPEE)))
    l5b.receipt(p["id"], text=True)
    print("   two Payments to one Mortgage on one day: the second's still owed")
    l5c = Copy(built, "l5-sameday")
    _, a = l5c.call("post", "/payments", json=pay(MEERA, "2026-10-19", "upi", (CHAIN, 2_000 * RUPEE)))
    _, b = l5c.call("post", "/payments", json=pay(MEERA, "2026-10-19", "cash", (CHAIN, 1_000 * RUPEE)))
    l5c.receipt(a["id"])
    l5c.receipt(b["id"])
    print("   the mixed Payment's Receipt as text (L2 copy before the reopen is gone; redo):")
    l5d = Copy(built, "l5-mixed")
    l5d.call("post", "/payments", json=mixed)
    l5d.receipt(34, text=True)

    # ------------------------------------------------------------ 99
    print("\n== 99. Check yourself")
    print("   Kavita pays ₹2,000 cash to the anklet on 19 Oct (it owes ₹0): ")
    ro.call("post", "/payments/preview", json=pay(KAVITA, "2026-10-19", "cash", (ANKLET, 2_000 * RUPEE)))
    print("   Arjun pays his chain's whole Outstanding plus ₹1,000 on his ring, cash:")
    arjun = 2
    _, people = ro.call("get", f"/mortgages/{ARJUNCHAIN}", quiet=True)
    arjun = people["customer"]["id"]
    ac = ro.owes(ARJUNCHAIN)
    print("     Arjun is customer", arjun, "; his chain owes", rs(ac), "; ring owes", rs(ro.owes(RING)))
    _, pv = ro.call("post", "/payments/preview", json=pay(arjun, "2026-10-19", "cash", (RING, 1_000 * RUPEE), (ARJUNCHAIN, ac)))
    preview_lines(pv)
    l99 = Copy(built, "l99")
    _, p = l99.call("post", "/payments", json=pay(arjun, "2026-10-19", "cash", (RING, 1_000 * RUPEE), (ARJUNCHAIN, ac)))
    l99.sql("SELECT id, amount, received_with FROM payment WHERE id >= 34")
    l99.receipt(p["id"], text=True)
    l99.call("post", "/payments/35/void", json={"reason": "test"})


if __name__ == "__main__":
    main()
