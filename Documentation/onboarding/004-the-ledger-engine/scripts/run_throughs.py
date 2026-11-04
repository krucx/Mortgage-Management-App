"""Checks every figure chapter 004 shows, against the real Ledger engine.

For the course's editors. Builds the sample book in a temporary folder (never the
Lender's data), reads each Mortgage's stored facts back through `replays()`, then calls
the pure functions in `lending/ledger.py` directly: the real Ledgers on 19 Oct 2026,
dates the book can't reach (10 Nov 2026), and one-change-at-a-time variations.

    cd backend && uv run python ../Documentation/onboarding/004-the-ledger-engine/scripts/run_throughs.py

Amounts print in rupees (the engine works in paise). Each section is headed with the
lesson that quotes it.
"""

import sys
import tempfile
from datetime import date, datetime, time
from pathlib import Path

from fastapi.testclient import TestClient
from sqlalchemy import create_engine

REPO = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(REPO / "docs" / "sample-book"))

import book  # noqa: E402

from mortgage_backend.lending.ledger import (  # noqa: E402
    Allocation,
    HypotheticalPayments,
    Overpayment,
    TermChange,
    accrual_date,
    compute_ledger,
    interest_to_date_charge,
    is_accrual_date,
    monthly_interest,
    months_unpaid,
    project,
)
from mortgage_backend.lending.replay import replays  # noqa: E402
from mortgage_backend.lending.terms import InterestMode, PartMonthRule, Terms  # noqa: E402
from mortgage_backend.main import create_app  # noqa: E402
from mortgage_backend.platform.db import mortgage_table  # noqa: E402

THE_DAY = book.THE_DAY
RUPEE = 100


def rs(paise: int) -> str:
    return f"{paise / RUPEE:,.2f}".removesuffix(".00")


def show(steps, only_from: date | None = None) -> None:
    print(f"   {'date':10} {'event':16} {'amount':>9} {'Principal':>10} {'unpaid':>8}"
          f" {'charged_on':>10} {'ahead':>7} {'int paid':>8} {'pr paid':>8} {'id':>4}")
    for s in steps:
        if only_from and s.on < only_from:
            continue
        print(f"   {s.on!s:10} {s.event:16} {rs(s.amount):>9} {rs(s.principal):>10}"
              f" {rs(s.unpaid_interest):>8} {rs(s.charged_on):>10} {rs(s.paid_ahead):>7}"
              f" {rs(s.interest_paid):>8} {rs(s.principal_paid):>8} {s.payment_id or '':>4}"
              + (f"  days={s.interest_to_date_days}" if s.event == "interest_to_date" else "")
              + (f"  terms={s.terms.monthly_rate_bps}bps" if s.terms else ""))


def owed(steps) -> int:
    return steps[-1].principal + steps[-1].unpaid_interest


def ledger_of(m, as_of: date, allocations=None, term_changes=None):
    row = m.row
    return compute_ledger(
        row["start_date"], row["amount_lent"], m._terms, as_of,
        m.allocations if allocations is None else allocations,
        term_changes=m.term_changes if term_changes is None else term_changes,
    )


def main() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        folder = Path(tmp)
        book.write(folder)
        db = folder / "data" / "mortgage.db"
        with create_engine(f"sqlite:///{db}").connect() as conn:
            rows = conn.execute(mortgage_table.select()).mappings().all()
            by_name = {r["name"]: r["id"] for r in rows}
            ms = replays(conn, rows)
        app = create_app(
            f"sqlite:///{db}",
            today=lambda: THE_DAY,
            now=lambda: datetime.combine(THE_DAY, time(11, 0)),
            backup_dir=folder / "backups",
        )
        with TestClient(app) as api:
            report({name: ms[i] for name, i in by_name.items()}, by_name, api)


def report(m, ids, api) -> None:
    chain = m["2025-Meera-GoldChainPendant"]
    bangles = m["2026-Meera-PairBangles"]
    ring = m["2025-Arjun-GoldRingRuby"]
    anklet = m["2026-Kavita-SilverGoldAnklet"]
    print("ids:", ids)

    # ---------------------------------------------------------------- lesson 1
    print("\n== L1. Kavita's anklet: stored facts")
    r = anklet.row
    print("   start", r["start_date"], "lent", rs(r["amount_lent"]), "terms", anklet._terms.model_dump())
    for a in sorted(anklet.allocations, key=lambda a: a.payment_id):
        print(f"   allocation: payment {a.payment_id} on {a.on} {rs(a.amount)}")
    entered = sorted(anklet.allocations, key=lambda a: a.payment_id)  # in the order typed in
    for k in range(len(entered) + 1):
        print(f"\n   Ledger on 19 Oct after entering {k} of the 3 Payments:")
        steps = ledger_of(anklet, THE_DAY, entered[:k])
        show(steps)
        print("   owed:", rs(owed(steps)))
    print("\n   Overpayment: the 25 Aug Payment typed as ₹15,400 instead")
    wrong = [Allocation(a.on, 15_400 * RUPEE if a.amount == 15_000 * RUPEE else a.amount, a.payment_id)
             for a in entered]
    try:
        ledger_of(anklet, THE_DAY, wrong)
    except Overpayment as e:
        print("   Overpayment:", e, "| payment_id", e.payment_id, "outstanding", rs(e.outstanding))
    print("   The same through the API: Preview of ₹1 more on 25 Aug, as a fourth Payment")
    body = {"customer_id": anklet.row["customer_id"], "paid_on": "2026-08-25", "amount": 1 * RUPEE,
            "method": "cash", "reference": None,
            "allocations": [{"mortgage_id": anklet.row["id"], "amount": 1 * RUPEE}]}
    pv = api.post("/api/payments/preview", json=body)
    print("   preview:", pv.status_code, pv.json())

    # ---------------------------------------------------------------- lesson 2
    print("\n== L2. One month's interest")
    two = Terms(monthly_rate_bps=200, interest_mode="compounded_yearly", part_month_rule="pro_rata")
    print("   chain: monthly_interest(80,000, 200bps) =", rs(monthly_interest(80_000 * RUPEE, two)))
    print("   numerator/denominator: ", 80_000 * RUPEE * 200 * 30, 10_000 * 30 * 100)
    for d in (1, 9, 10, 15, 30, 31):
        print(f"   pro-rata {d:>2} days: {rs(interest_to_date_charge(80_000 * RUPEE, two, d))}")
    full = two.model_copy(update={"part_month_rule": PartMonthRule.FULL_MONTH})
    nothing = two.model_copy(update={"part_month_rule": PartMonthRule.NOTHING})
    print("   full month, 1 day:", rs(interest_to_date_charge(80_000 * RUPEE, full, 1)),
          "  nothing, 29 days:", rs(interest_to_date_charge(80_000 * RUPEE, nothing, 29)))
    ring_terms = ring._terms
    for p in (61_500, 60_000, 61_520, 61_540):
        print(f"   2.5% of {p:,}: {rs(monthly_interest(p * RUPEE, ring_terms))}"
              f"  (exact {p * 0.025:.2f})")
    print("   2% of 333.25 (half-up check, 666.5 paise):",
          rs(monthly_interest(33_325, two)), " 2% of 337.50:", rs(monthly_interest(33_750, two)))
    print("   1.5% on 1,40,000:", rs(monthly_interest(1_40_000 * RUPEE, two.model_copy(update={"monthly_rate_bps": 150}))))
    print("   fresh-database Default Terms 3% on 80,000:",
          rs(monthly_interest(80_000 * RUPEE, two.model_copy(update={"monthly_rate_bps": 300}))))
    for start in (date(2026, 1, 31), date(2026, 10, 31), date(2025, 11, 10)):
        print(f"   accrual dates of {start}:", [str(accrual_date(start, n)) for n in range(0, 5)])
    print("   is_accrual_date(31 Jan, 28 Feb):", is_accrual_date(date(2026, 1, 31), date(2026, 2, 28)),
          " (31 Jan, 31 Jan):", is_accrual_date(date(2026, 1, 31), date(2026, 1, 31)))
    print("   anklet ITD on 19 Oct (nothing):")
    show(ledger_of(anklet, THE_DAY)[-2:])
    print("   anklet if pro-rata instead, 19 Oct:")
    pr = anklet._terms.model_copy(update={"part_month_rule": PartMonthRule.PRO_RATA})
    show(compute_ledger(anklet.row["start_date"], anklet.row["amount_lent"], pr, THE_DAY,
                        anklet.allocations)[-1:])
    print("   anklet if full month, 19 Oct:")
    fm = anklet._terms.model_copy(update={"part_month_rule": PartMonthRule.FULL_MONTH})
    show(compute_ledger(anklet.row["start_date"], anklet.row["amount_lent"], fm, THE_DAY,
                        anklet.allocations)[-1:])

    # ---------------------------------------------------------------- lesson 3
    print("\n== L3. Meera's chain on 19 Oct")
    steps = ledger_of(chain, THE_DAY)
    show(steps)
    print("   owed (Outstanding):", rs(owed(steps)), " Months Unpaid:", months_unpaid(steps))
    for day in ("2026-03-10", "2026-04-10", "2026-05-10", "2026-09-10", "2026-10-10"):
        s = ledger_of(chain, date.fromisoformat(day))
        print(f"   months_unpaid on {day}: {months_unpaid(s)}")
    base = [a for a in chain.allocations]

    def variant(label, extra=(), drop=None, as_of=THE_DAY, from_=date(2026, 9, 1)):
        allocs = [a for a in base if a.payment_id != drop] + list(extra)
        print(f"\n   Variant: {label}")
        try:
            s = ledger_of(chain, as_of, allocs)
        except Overpayment as e:
            print("   Overpayment:", e, "| outstanding", rs(e.outstanding))
            return None
        show(s, from_)
        print("   owed:", rs(owed(s)), " Months Unpaid:", months_unpaid(s))
        return s

    sep = next(a for a in base if a.on == date(2026, 9, 10))
    variant("she pays ₹50,000 on 9 Oct (day before the Accrual Date)", [Allocation(date(2026, 10, 9), 50_000 * RUPEE, 900)])
    variant("she pays ₹50,000 on 10 Oct (on the Accrual Date)", [Allocation(date(2026, 10, 10), 50_000 * RUPEE, 900)],
            as_of=date(2026, 11, 10))
    variant("she pays ₹50,000 on 9 Oct, seen on 10 Nov", [Allocation(date(2026, 10, 9), 50_000 * RUPEE, 900)],
            as_of=date(2026, 11, 10))
    variant("she pays ₹50,000 on 11 Oct, seen on 10 Nov", [Allocation(date(2026, 10, 11), 50_000 * RUPEE, 900)],
            as_of=date(2026, 11, 10))
    variant("she pays ₹6,600 on 19 Oct (more than the interest charged)", [Allocation(THE_DAY, 6_600 * RUPEE, 900)])
    variant("she pays ₹3,333 on 19 Oct (the unpaid + ITD exactly)", [Allocation(THE_DAY, 3_333 * RUPEE, 900)],
            as_of=date(2026, 11, 10))
    variant("she pays ₹3,333 on 19 Oct, on the day", [Allocation(THE_DAY, 3_333 * RUPEE, 900)])
    variant("she pays ₹1,600 on 19 Oct, seen on 10 Nov", [Allocation(THE_DAY, 1_600 * RUPEE, 900)],
            as_of=date(2026, 11, 10))
    variant("her April Payment had been made after all (₹1,600 on 10 Apr)",
            [Allocation(date(2026, 4, 10), 1_600 * RUPEE, 900)], from_=date(2026, 3, 1))
    variant("April missed, and the ₹2,000 on 10 Sep moved to 9 Sep", [Allocation(date(2026, 9, 9), 2_000 * RUPEE, 900)],
            drop=sep.payment_id, from_=date(2026, 8, 1))
    print("\n   Overpayment: ₹83,334 on 19 Oct (owed ₹83,333)")
    variant("₹83,334 on 19 Oct", [Allocation(THE_DAY, 83_334 * RUPEE, 900)])
    print("\n   Months Unpaid, capitalised but unpaid: chain on 10 Nov, no more Payments")
    s = ledger_of(chain, date(2026, 11, 10))
    print("   months_unpaid 10 Nov:", months_unpaid(s))
    s = ledger_of(chain, date(2026, 11, 9))
    print("   months_unpaid 9 Nov:", months_unpaid(s))

    # ---------------------------------------------------------------- lesson 4
    print("\n== L4. Arjun's ring (Compounded Monthly) to 15 Jan 2026, then 19 Oct 2026")
    rs_ = ledger_of(ring, date(2026, 1, 15))
    show(rs_)
    rs2 = ledger_of(ring, THE_DAY)
    show(rs2, date(2026, 8, 1))
    print("   owed 19 Oct:", rs(owed(rs2)), " Months Unpaid:", months_unpaid(rs2))
    print("   capitalised steps:", sum(1 for s in rs2 if s.event == "capitalised"))
    print("\n   The ring, had it been Simple (what it would owe 19 Oct):")
    simple = ring._terms.model_copy(update={"interest_mode": InterestMode.SIMPLE})
    s = compute_ledger(ring.row["start_date"], ring.row["amount_lent"], simple, THE_DAY, ring.allocations)
    show(s[-2:])
    print("   owed:", rs(owed(s)))
    print("\n   Ring variants on 15 Sep 2025 (one capitalisation)")
    for label, extra in (
        ("as stored", []),
        ("pays ₹1,000 on 15 Sep", [Allocation(date(2025, 9, 15), 1_000 * RUPEE, 900)]),
        ("pays ₹1,550 on 15 Sep", [Allocation(date(2025, 9, 15), 1_550 * RUPEE, 900)]),
        ("pays ₹1,550 on 14 Sep", [Allocation(date(2025, 9, 14), 1_550 * RUPEE, 900)]),
    ):
        print(f"   -- {label}")
        show(ledger_of(ring, date(2025, 9, 15), list(ring.allocations) + extra), date(2025, 8, 14))

    print("\n   Meera's chain on its first anniversary, 10 Nov 2026 (no more Payments)")
    show(ledger_of(chain, date(2026, 11, 10)), date(2026, 10, 1))
    print("   chain on 10 Dec 2026:")
    show(ledger_of(chain, date(2026, 12, 10)), date(2026, 11, 10))
    for label, extra in (
        ("pays ₹4,400 on 10 Nov", [Allocation(date(2026, 11, 10), 4_400 * RUPEE, 900)]),
        ("pays ₹2,800 on 10 Nov", [Allocation(date(2026, 11, 10), 2_800 * RUPEE, 900)]),
        ("pays ₹4,400 on 9 Nov", [Allocation(date(2026, 11, 9), 4_400 * RUPEE, 900)]),
        ("pays ₹2,800 on 9 Nov", [Allocation(date(2026, 11, 9), 2_800 * RUPEE, 900)]),
        ("pays ₹1,000 on 9 Nov", [Allocation(date(2026, 11, 9), 1_000 * RUPEE, 900)]),
        ("pays ₹4,000 on 9 Nov", [Allocation(date(2026, 11, 9), 4_000 * RUPEE, 900)]),
    ):
        print(f"   -- {label}")
        show(ledger_of(chain, date(2026, 11, 10), list(chain.allocations) + extra), date(2026, 11, 1))

    # ---------------------------------------------------------------- lesson 5
    print("\n== L5. Meera's bangles: Term Change and Projection")
    print("   term changes:", bangles.term_changes)
    show(ledger_of(bangles, THE_DAY))
    print("   on 25 Oct, 25 Nov and 25 Dec:")
    show(ledger_of(bangles, date(2026, 12, 25)), date(2026, 10, 25))
    print("   without the Term Change, 25 Nov:")
    show(ledger_of(bangles, date(2026, 11, 25), term_changes=[]), date(2026, 11, 25))
    print("   terms_on 24 Oct / 25 Oct:", bangles.terms_on(date(2026, 10, 24)).monthly_rate_bps,
          bangles.terms_on(date(2026, 10, 25)).monthly_rate_bps)
    print("   a change on 10 Nov (not an Accrual Date) would be refused by the route; the engine:")
    print("   projection dates:", [str(accrual_date(THE_DAY, k)) for k in range(13)])
    p = api.get(f"/api/mortgages/{bangles.row['id']}/projection").json()
    print("   GET projection baseline:")
    for pt in p["baseline"]["points"]:
        print(f"   {pt['months']:>2} {pt['on']} Principal {rs(pt['principal'])} unpaid+ITD {rs(pt['unpaid_interest'])}"
              f" outstanding {rs(pt['outstanding'])} LTV {pt['loan_to_value'] and round(pt['loan_to_value'] * 100, 1)}")
    print("   coming term changes:", p["baseline"]["term_changes"], "paid off:", p["baseline"]["paid_off_on"])
    p = api.get(f"/api/mortgages/{bangles.row['id']}/projection", params={"monthly_payment": 10_000 * RUPEE}).json()
    print("   what-if ₹10,000 a month:")
    for pt in p["what_if"]["points"]:
        print(f"   {pt['months']:>2} {pt['on']} Principal {rs(pt['principal'])} outstanding {rs(pt['outstanding'])}")
    print("   paid off on:", p["what_if"]["paid_off_on"])
    print("   the same with project() directly, first two hypothetical Payments:")
    row = bangles.row
    s = compute_ledger(row["start_date"], row["amount_lent"], bangles._terms, date(2026, 11, 25), bangles.allocations,
                       term_changes=bangles.term_changes,
                       hypothetical=HypotheticalPayments(THE_DAY, 10_000 * RUPEE))
    show(s, date(2026, 10, 20))
    print("   hypothetical on a day with a real Payment: bangles, real ₹5,000 on 25 Oct + ₹10,000 hypothetical")
    s = compute_ledger(row["start_date"], row["amount_lent"], bangles._terms, date(2026, 10, 25),
                       list(bangles.allocations) + [Allocation(date(2026, 10, 25), 5_000 * RUPEE, 900)],
                       term_changes=bangles.term_changes,
                       hypothetical=HypotheticalPayments(THE_DAY, 10_000 * RUPEE))
    show(s, date(2026, 10, 20))
    print("   Term Change on an Accrual Date under Compounded Yearly, chain → Simple from 10 Nov 2026:")
    s = ledger_of(chain, date(2026, 11, 10), term_changes=[TermChange(date(2026, 11, 10), interest_mode=InterestMode.SIMPLE)])
    show(s, date(2026, 11, 1))
    print("   project() snapshots for the bangles, 19 Oct and 19 Nov:")
    pr = project(row["start_date"], row["amount_lent"], bangles._terms, [THE_DAY, date(2026, 11, 19)],
                 bangles.allocations, bangles.term_changes)
    for sn in pr.snapshots:
        print("  ", sn.on, rs(sn.principal), rs(sn.unpaid_interest), rs(sn.outstanding), rs(sn.interest_charged))
    print("   term_changes in view:", pr.term_changes)

    # ---------------------------------------------------------------- check yourself
    print("\n== 99. Arjun's gold chain (accrues on the 19th), for the quiz")
    arjun_chain = m["2026-Arjun-GoldChain"]
    s = ledger_of(arjun_chain, THE_DAY)
    show(s)
    print("   owed:", rs(owed(s)), " Months Unpaid:", months_unpaid(s))
    print("   with ₹1,000 paid on 18 Oct:")
    show(ledger_of(arjun_chain, THE_DAY, list(arjun_chain.allocations) + [Allocation(date(2026, 10, 18), 1_000 * RUPEE, 900)]))


if __name__ == "__main__":
    main()
