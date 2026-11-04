"""Checks every figure chapter 005 shows, against the real replay and Closure code.

For the course's editors. Builds the sample book once in a temporary folder (never the
Lender's data), then works on fresh copies of its database: one read-only, and one per
change a lesson makes (a Reopen, a Redemption, a refused Payment), so no change leaks
into another lesson's figures.

    cd backend && uv run python ../Documentation/onboarding/005-replay-and-closures/scripts/run_throughs.py

Amounts print in rupees (the code works in paise). Each section is headed with the
lesson that quotes it (L1–L5, 99).
"""

import shutil
import sys
import tempfile
from datetime import date, datetime, time
from pathlib import Path

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event, select

REPO = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(REPO / "docs" / "sample-book"))

import book  # noqa: E402

from mortgage_backend.lending.ledger import Allocation  # noqa: E402
from mortgage_backend.lending.replay import MortgageReplay, replay, replays  # noqa: E402
from mortgage_backend.main import create_app  # noqa: E402
from mortgage_backend.platform.db import mortgage_table, payment_table  # noqa: E402

THE_DAY = book.THE_DAY
RUPEE = 100
RING, CHAIN, COIN, NECKLACE, BANGLES, NOSERING, EARRINGS, ARJUNCHAIN, MANGALSUTRA, ANKLET = range(1, 11)


def rs(paise: int | None) -> str:
    if paise is None:
        return "None"
    return f"{paise / RUPEE:,.2f}".removesuffix(".00")


def show(steps, only_from: date | None = None) -> None:
    print(f"   {'date':10} {'event':16} {'amount':>9} {'Principal':>10} {'unpaid':>8}"
          f" {'ahead':>7} {'int paid':>8} {'pr paid':>8} {'id':>4}")
    for s in steps:
        if only_from and s.on < only_from:
            continue
        print(f"   {s.on!s:10} {s.event:16} {rs(s.amount):>9} {rs(s.principal):>10}"
              f" {rs(s.unpaid_interest):>8} {rs(s.paid_ahead):>7}"
              f" {rs(s.interest_paid):>8} {rs(s.principal_paid):>8} {s.payment_id or '':>4}"
              + (f"  days={s.interest_to_date_days}" if s.event == "interest_to_date" else ""))


def quote(q) -> str:
    return (f"on {q.on}: Principal {rs(q.principal)} + unpaid {rs(q.unpaid_interest)}"
            f" + ITD {rs(q.interest_to_date)} ({q.interest_to_date_days} days from {q.last_accrual_on})"
            f" = {rs(q.total)}")


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

    def m(self, mortgage_id: int) -> MortgageReplay:
        with create_engine(self.url).connect() as conn:
            return replay(conn, mortgage_id)

    def call(self, method: str, path: str, **kw):
        r = getattr(self.api, method)(path, **kw)
        body = r.json()
        detail = body.get("detail") if isinstance(body, dict) else None
        print(f"   {method.upper()} {path} -> {r.status_code}" + (f": {detail}" if detail else ""))
        return r.status_code, body


MONEY = {"principal", "unpaid_interest", "interest_to_date", "total", "outstanding", "payment_amount",
         "waived_amount", "recovered_amount", "profit_loss", "amount", "amount_lent"}


def money(d: dict) -> dict:
    return {k: rs(v) if k in MONEY and isinstance(v, int) else v for k, v in d.items()}


def payment(customer_id: int, on: str, allocations: dict[int, int], method: str = "cash") -> dict:
    return {"customer_id": customer_id, "paid_on": on, "amount": sum(allocations.values()),
            "method": method, "reference": None,
            "allocations": [{"mortgage_id": m, "amount": a} for m, a in allocations.items()]}


def preview_lines(body) -> None:
    for m in body["mortgages"]:
        b, a = m["before"], m["after"]
        kind = lambda side: side["closure"]["kind"] if side["closure"] else "active"
        print(f"     {m['mortgage_name']}: {kind(b)} owes {rs(b['outstanding'])}"
              f" -> {kind(a)} owes {rs(a['outstanding'])}")
        if a["closure"]:
            print("       after closure:", money(a["closure"]))
        for c in m["ledger_changes"]:
            print("       ledger change:", c)


def main() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        folder = Path(tmp) / "book"
        book.write(folder)
        built = folder / "data" / "mortgage.db"
        report(built)


def report(built: Path) -> None:
    ro = Copy(built, "read-only")
    with create_engine(ro.url).connect() as conn:
        rows = conn.execute(mortgage_table.select().order_by(mortgage_table.c.id)).mappings().all()
        print("ids:", {r["id"]: (r["name"], r["status"], str(r["closed_on"]), r["redemption_payment_id"],
                                 rs(r["recovered_amount"])) for r in rows})
        customers = {r["id"]: r["customer_id"] for r in rows}

        # ------------------------------------------------------------ lesson 1
        print("\n== L1. Outstanding: Lakshmi's necklace before 16 Oct")
        necklace = replay(conn, NECKLACE)
        print("   allocations:", sorted((str(a.on), rs(a.amount), a.payment_id) for a in necklace.allocations))
        for d in ("2026-09-19", "2026-09-20", "2026-10-01", "2026-10-15", "2026-10-16", "2026-10-19"):
            o = necklace.outstanding(date.fromisoformat(d))
            print(f"   outstanding({d}): Principal {rs(o.principal)} + unpaid {rs(o.unpaid_interest)} = {rs(o.total)}")
        print("   ledger(15 Oct), from 1 Sep:")
        show(necklace.ledger(date(2026, 10, 15)), date(2026, 9, 1))
        print("   ledger(19 Oct) (closed 16 Oct), from 1 Sep:")
        show(necklace.ledger(THE_DAY), date(2026, 9, 1))
        print("   cache keys after those calls:", sorted(str(k) for k in necklace._ledgers))

        print("\n   replays(): queries for all", len(rows), "Mortgages")
        count = {"n": 0}

        def counter(*_a, **_k):
            count["n"] += 1

        event.listen(conn.engine, "before_cursor_execute", counter)
        everyone = replays(conn, rows)
        event.remove(conn.engine, "before_cursor_execute", counter)
        print("   queries:", count["n"])
        for i, m in everyone.items():
            print(f"   {i:>2} {m.row['name']:30} {m.row['status']:9} outstanding(19 Oct) {rs(m.outstanding(THE_DAY).total):>9}"
                  f"  dormant {m.dormant(THE_DAY)}")

        print("\n   The Voided ₹16,000 on the bangles:")
        voided = conn.execute(select(payment_table).where(payment_table.c.voided_at.is_not(None))).mappings().all()
        for p in voided:
            print("   voided payment", p["id"], p["paid_on"], rs(p["amount"]), p["void_reason"])
        print("   bangles allocations:", sorted((str(a.on), rs(a.amount), a.payment_id) for a in everyone[BANGLES].allocations))

        # ------------------------------------------------------------ lesson 2
        print("\n== L2. Closing on a date: Farida's nose ring")
        nose = replay(conn, NOSERING)
        print("   allocations:", sorted((str(a.on), rs(a.amount), a.payment_id) for a in nose.allocations))
        print("   final payment id:", nose.row["redemption_payment_id"])
        q = nose.outstanding_on_closure(date(2026, 10, 16))
        print("   outstanding_on_closure(16 Oct):", quote(q))
        print("   ", q.model_dump())
        print("   not_closable(16 Oct) as stored:", nose.not_closable(date(2026, 10, 16)))
        print("   ledger(19 Oct) of the Waived nose ring, from 12 Sep:")
        show(nose.ledger(THE_DAY), date(2026, 9, 12))
        for d in ("2026-10-12", "2026-10-13", "2026-10-15", "2026-11-11"):
            print("   quote", quote(nose.outstanding_on_closure(date.fromisoformat(d))))
        print("   outstanding_on_closure ledger, 16 Oct (quote, no closure kind):")
        show(nose._replay(date(2026, 10, 16),
                          [a for a in nose.allocations if a.payment_id != nose.row["redemption_payment_id"]],
                          closed_on=date(2026, 10, 16)), date(2026, 9, 12))
        print("   variant: another ₹100 Payment that same day before closing (id 900):")
        extra = [a for a in nose.allocations if a.payment_id != nose.row["redemption_payment_id"]] + [
            Allocation(date(2026, 10, 16), 100 * RUPEE, 900)]
        show(nose._replay(date(2026, 10, 16), extra, closed_on=date(2026, 10, 16)), date(2026, 10, 12))

    print("\n   The quote route on the served book")
    ro.call("get", f"/api/mortgages/{NOSERING}/outstanding-on-closure", params={"on": "2026-10-16"})
    s, b = ro.call("get", f"/api/mortgages/{CHAIN}/outstanding-on-closure", params={"on": "2026-10-19"})
    print("   chain 19 Oct:", money(b))
    s, b = ro.call("get", f"/api/mortgages/{CHAIN}/outstanding-on-closure", params={"on": "2026-11-10"})
    print("   chain 10 Nov (future quote):", money(b))
    ro.call("get", f"/api/mortgages/{CHAIN}/outstanding-on-closure", params={"on": "2026-09-01"})
    ro.call("get", f"/api/mortgages/{CHAIN}/outstanding-on-closure", params={"on": "2025-11-01"})
    ro.call("post", f"/api/mortgages/{CHAIN}/redeem-preview",
            json={"redeemed_on": "2026-11-10", "method": "cash"})
    ro.call("post", f"/api/mortgages/{CHAIN}/redeem-preview",
            json={"redeemed_on": "2026-09-01", "method": "cash"})

    farida = Copy(built, "farida-reopened")
    farida.call("post", f"/api/mortgages/{NOSERING}/reopen", json={"reason": "course: quote again"})
    s, b = farida.call("get", f"/api/mortgages/{NOSERING}/outstanding-on-closure", params={"on": "2026-10-16"})
    print("   reopened nose ring, 16 Oct:", money(b))
    farida.call("get", f"/api/mortgages/{NOSERING}/outstanding-on-closure", params={"on": "2026-09-01"})

    # ---------------------------------------------------------------- lesson 3
    print("\n== L3. Redeemed, two ways")
    with create_engine(ro.url).connect() as conn:
        coin = replay(conn, COIN)
        print("   coin allocations:", sorted((str(a.on), rs(a.amount), a.payment_id) for a in coin.allocations))
        print("   coin quote 5 Oct:", quote(coin.outstanding_on_closure(date(2026, 10, 5))))
        print("   coin closure:", money(coin.closure().model_dump()))
        print("   coin ledger(19 Oct), from 18 Aug:")
        show(coin.ledger(THE_DAY), date(2026, 8, 18))
        necklace = replay(conn, NECKLACE)
        print("   necklace quote 16 Oct:", quote(necklace.outstanding_on_closure(date(2026, 10, 16))))
        print("   necklace closure:", money(necklace.closure().model_dump()))
        print("   necklace ledger(19 Oct), from 20 Sep:")
        show(necklace.ledger(THE_DAY), date(2026, 9, 20))
        final = necklace.row["redemption_payment_id"]
        p = conn.execute(select(payment_table).where(payment_table.c.id == final)).mappings().one()
        print("   necklace final payment row:", dict(p))
        p = conn.execute(select(payment_table).where(payment_table.c.id == coin.row["redemption_payment_id"])).mappings().one()
        print("   coin final payment row:", dict(p))

    s, b = ro.call("get", f"/api/payments/{final}")
    print("   GET payment:", {k: b[k] for k in ("id", "paid_on", "amount", "method")}, [
        (line.get("mortgage_name") or line.get("name"), line.get("redeemed")) for line in b.get("mortgages", b.get("allocations", []))])
    ro.call("post", "/api/payments/preview", json=payment(customers[NECKLACE], "2026-10-16", {NECKLACE: 1 * RUPEE}))

    lak = Copy(built, "lakshmi-reopened")
    lak.call("post", f"/api/mortgages/{NECKLACE}/reopen", json={"reason": "course: pay again"})
    print("   reopened necklace quote 16 Oct:", quote(lak.m(NECKLACE).outstanding_on_closure(date(2026, 10, 16))))
    print("   reopened necklace quote 1 Sep:", quote(lak.m(NECKLACE).outstanding_on_closure(date(2026, 9, 1))))
    print("   reopened necklace quote 19 Oct:", quote(lak.m(NECKLACE).outstanding_on_closure(THE_DAY)))
    for label, on, amt in (("exact, 16 Oct", "2026-10-16", 2_03_600), ("a rupee less, 16 Oct", "2026-10-16", 2_03_599),
                           ("exact Outstanding on 1 Sep", "2026-09-01", None)):
        if amt is None:
            amt = lak.m(NECKLACE).outstanding_on_closure(date(2026, 9, 1)).total // RUPEE
        print(f"   preview {label}: ₹{amt:,}")
        s, b = lak.call("post", "/api/payments/preview", json=payment(customers[NECKLACE], on, {NECKLACE: amt * RUPEE}, "bank_transfer"))
        if s == 200:
            preview_lines(b)
    print("   save a rupee less on 16 Oct:")
    s, b = lak.call("post", "/api/payments", json=payment(customers[NECKLACE], "2026-10-16", {NECKLACE: 2_03_599 * RUPEE}, "bank_transfer"))
    m = lak.m(NECKLACE)
    print("   status:", m.row["status"], " outstanding 16 Oct:", rs(m.outstanding(date(2026, 10, 16)).total),
          " 19 Oct:", rs(m.outstanding(THE_DAY).total), " dormant:", m.dormant(THE_DAY))
    show(m.ledger(THE_DAY), date(2026, 10, 1))

    print("   Two Allocations in one Payment, one of them a whole Outstanding (Meera: chain exact + bangles ₹1,000):")
    mee = Copy(built, "meera-two")
    chain_owed = mee.m(CHAIN).outstanding_on_closure(THE_DAY).total
    s, b = mee.call("post", "/api/payments/preview", json=payment(customers[CHAIN], "2026-10-19", {CHAIN: chain_owed, BANGLES: 1_000 * RUPEE}, "upi"))
    if s == 200:
        preview_lines(b)

    # ---------------------------------------------------------------- lesson 4
    print("\n== L4. Waived and Forfeited")
    with create_engine(ro.url).connect() as conn:
        nose = replay(conn, NOSERING)
        print("   nose closure:", money(nose.closure().model_dump()))
        final_n = nose.row["redemption_payment_id"]
        print("   owed_after(final, 16 Oct):", rs(nose.owed_after(final_n, date(2026, 10, 16))))
        ear = replay(conn, EARRINGS)
        print("   earrings allocations:", sorted((str(a.on), rs(a.amount), a.payment_id) for a in ear.allocations))
        print("   earrings quote 10 Oct:", quote(ear.outstanding_on_closure(date(2026, 10, 10))))
        print("   earrings closure:", money(ear.closure().model_dump()))
        print("   earrings ledger(19 Oct), from 10 Jul:")
        show(ear.ledger(THE_DAY), date(2026, 7, 10))
        print("   earrings outstanding(19 Oct):", rs(ear.outstanding(THE_DAY).total))
        aug = next(a for a in ear.allocations if a.on == date(2026, 8, 10))
        print("   earrings owed_after(Aug payment, 10 Aug):", rs(ear.owed_after(aug.payment_id, date(2026, 8, 10))))
    print("   refusals (Previews on the served book)")
    ro.call("post", f"/api/mortgages/{ANKLET}/waive-preview",
            json={"waived_on": "2026-10-19", "amount_paid": 0, "method": "cash", "note": ""})
    chain_q = ro.m(CHAIN).outstanding_on_closure(THE_DAY).total
    ro.call("post", f"/api/mortgages/{CHAIN}/waive-preview",
            json={"waived_on": "2026-10-19", "amount_paid": chain_q, "method": "cash", "note": ""})
    s, b = ro.call("post", f"/api/mortgages/{CHAIN}/waive-preview",
                   json={"waived_on": "2026-10-19", "amount_paid": chain_q - 333 * RUPEE, "method": "cash", "note": ""})
    if s == 200:
        preview_lines(b)
    s, b = ro.call("post", f"/api/mortgages/{CHAIN}/forfeit-preview",
                   json={"forfeited_on": "2026-10-19", "recovered_amount": 2_60_000 * RUPEE, "note": ""})
    if s == 200:
        preview_lines(b)
        print("   ", {k: v for k, v in b.items() if k != "mortgages"})
    ro.call("post", f"/api/mortgages/{EARRINGS}/forfeit-preview",
            json={"forfeited_on": "2026-10-19", "recovered_amount": 0, "note": ""})
    print("   bulk forfeit, one refused (chain ok, nose ring already waived):")
    ro.call("post", "/api/closures/forfeit-preview", json={"forfeited_on": "2026-10-19", "note": "",
            "mortgages": [{"mortgage_id": CHAIN, "recovered_amount": 0}, {"mortgage_id": NOSERING, "recovered_amount": 0}]})
    bulk = Copy(built, "bulk")
    bulk.call("post", "/api/closures/forfeit", json={"forfeited_on": "2026-10-19", "note": "",
              "mortgages": [{"mortgage_id": CHAIN, "recovered_amount": 0}, {"mortgage_id": NOSERING, "recovered_amount": 0}]})
    print("   chain status after the refused bulk:", bulk.m(CHAIN).row["status"])
    s, b = ro.call("get", f"/api/payments/{final_n}/receipt")
    print("   nose ring Receipt text:", (b.get("text") or b.get("whatsapp") or str(b))[:600] if isinstance(b, dict) else b)

    # ---------------------------------------------------------------- lesson 5
    print("\n== L5. Dormant, and undoing a Closure")
    s, b = ro.call("get", "/api/closures/dormant")
    print("   dormant list:", [(i["id"], i["name"], rs(i["outstanding_total"])) for i in b["items"]])
    with create_engine(ro.url).connect() as conn:
        ank = replay(conn, ANKLET)
        for d in ("2026-08-24", "2026-08-25", "2026-08-26", "2026-09-01", "2026-09-05", "2026-10-19"):
            print(f"   anklet {d}: outstanding {rs(ank.outstanding(date.fromisoformat(d)).total)}  dormant {ank.dormant(date.fromisoformat(d))}")
        print("   anklet quote 19 Oct:", quote(ank.outstanding_on_closure(THE_DAY)))
    print("   Void the 5 Sep ₹300 (Payment 32) on a copy:")
    vd = Copy(built, "anklet-void")
    vd.call("post", "/api/payments/32/void", json={"reason": "course"})
    print("   anklet now owes", rs(vd.m(ANKLET).outstanding(THE_DAY).total), "dormant", vd.m(ANKLET).dormant(THE_DAY))
    s, b = vd.call("get", "/api/closures/dormant")
    print("   dormant list:", [i["name"] for i in b["items"]])

    print("\n   Reopen 1: Redeem then Reopen the anklet")
    ak = Copy(built, "anklet-redeem")
    s, b = ak.call("post", f"/api/mortgages/{ANKLET}/redeem", json={"redeemed_on": "2026-10-19", "method": "cash"})
    print("   after redeem: status", b["status"], "closure:", money(b["closure"]))
    s, b = ak.call("get", "/api/closures/dormant")
    print("   dormant list:", [i["name"] for i in b["items"]])
    s, b = ak.call("post", f"/api/mortgages/{ANKLET}/reopen-preview")
    if s == 200:
        preview_lines(b)
    s, b = ak.call("post", f"/api/mortgages/{ANKLET}/reopen", json={"reason": "Redeemed by mistake"})
    print("   after reopen: status", b["status"], "outstanding", rs(b["outstanding"]["total"]), "closure", b["closure"])
    with create_engine(ak.url).connect() as conn:
        n_voided = conn.execute(select(payment_table).where(payment_table.c.voided_at.is_not(None))).all()
        print("   voided payments now:", [(r.id, rs(r.amount)) for r in n_voided])
    s, b = ak.call("get", "/api/closures/dormant")
    print("   dormant list:", [i["name"] for i in b["items"]])
    s, b = ak.call("post", f"/api/mortgages/{ANKLET}/reopen", json={"reason": "again"})

    print("\n   Reopen 2: the coin (UPI final Payment)")
    co = Copy(built, "coin-reopen")
    coin_final = co.m(COIN).row["redemption_payment_id"]
    co.call("post", f"/api/payments/{coin_final}/void", json={"reason": "course"})
    co.call("post", "/api/payments", json=payment(customers[COIN], "2026-10-19", {COIN: 100 * RUPEE}))
    co.call("post", f"/api/mortgages/{COIN}/term-changes", json={"effective_on": "2026-11-18", "monthly_rate_bps": 150})
    s, b = co.call("post", f"/api/mortgages/{COIN}/reopen-preview")
    if s == 200:
        preview_lines(b)
    s, b = co.call("post", f"/api/mortgages/{COIN}/reopen", json={"reason": "Redeemed on the wrong Mortgage"})
    print("   after reopen: status", b["status"], "outstanding", rs(b["outstanding"]["total"]), b["outstanding"])
    with create_engine(co.url).connect() as conn:
        p = conn.execute(select(payment_table).where(payment_table.c.id == coin_final)).mappings().one()
        print("   coin final payment row now:", {k: p[k] for k in ("id", "amount", "method", "voided_at", "void_reason")})
        c = replay(conn, COIN)
        print("   coin quote 19 Oct:", quote(c.outstanding_on_closure(THE_DAY)))
        show(c.ledger(THE_DAY), date(2026, 8, 18))

    print("\n   Reopen a Forfeiture (earrings), on a copy:")
    fo = Copy(built, "earrings-reopen")
    s, b = fo.call("post", f"/api/mortgages/{EARRINGS}/reopen", json={"reason": "course"})
    print("   after reopen: status", b["status"], "outstanding", rs(b["outstanding"]["total"]), "closure", b["closure"])
    with create_engine(fo.url).connect() as conn:
        r = conn.execute(select(mortgage_table).where(mortgage_table.c.id == EARRINGS)).mappings().one()
        print("   row:", {k: r[k] for k in ("status", "closed_on", "recovered_amount", "redemption_payment_id", "closure_note")})
        print("   voided payments:", conn.execute(select(payment_table.c.id).where(payment_table.c.voided_at.is_not(None))).all())

    print("\n   Reopen Farida's Waiver (nose ring): its final Payment")
    s, b = farida.call("get", f"/api/mortgages/{NOSERING}")
    print("   (already reopened above) status", b["status"], "outstanding", rs(b["outstanding"]["total"]))

    # ---------------------------------------------------------------- 99
    print("\n== 99. Check yourself")
    with create_engine(ro.url).connect() as conn:
        mang = replay(conn, MANGALSUTRA)
        for d in ("2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22"):
            print("   mangalsutra quote", quote(mang.outstanding_on_closure(date.fromisoformat(d))))
        arj = replay(conn, ARJUNCHAIN)
        print("   arjun chain quote", quote(arj.outstanding_on_closure(THE_DAY)))
        print("   chain quote", quote(replay(conn, CHAIN).outstanding_on_closure(THE_DAY)))
        print("   The exercise's break: the quote counting its own final Payment")
        for mid, on in ((NECKLACE, date(2026, 10, 16)), (NOSERING, date(2026, 10, 16)), (COIN, date(2026, 10, 5))):
            m = replay(conn, mid)
            steps = m._replay(on, m.allocations, closed_on=on)
            print(f"   {m.row['name']}: quote on {on} would be {rs(steps[-1].principal + steps[-1].unpaid_interest)}"
                  f" (really {rs(m.outstanding_on_closure(on).total)})")
    ro.call("post", "/api/payments/preview", json=payment(customers[ARJUNCHAIN], "2026-10-19", {ARJUNCHAIN: 46_830 * RUPEE}, "upi"))
    ro.call("post", "/api/payments/preview", json=payment(customers[ARJUNCHAIN], "2026-09-18", {ARJUNCHAIN: 45_000 * RUPEE + 0}, "upi"))
    s, b = ro.call("post", "/api/payments/preview", json=payment(customers[ARJUNCHAIN], "2026-10-19", {ARJUNCHAIN: 46_830 * RUPEE}, "upi"))
    if s == 200:
        preview_lines(b)
    ro.call("post", "/api/payments", json=payment(customers[COIN], "2026-10-19", {COIN: 100 * RUPEE}))
    ro.call("post", f"/api/mortgages/{CHAIN}/redeem", json={"redeemed_on": "2026-10-20", "method": "cash"})


if __name__ == "__main__":
    main()
