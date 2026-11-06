"""Checks every figure chapter 001 hand-works, against the real app.

Chapter 001 shows no code: the reader works figures out by hand from Terms. This script
is for the course's editors. It builds the sample book (docs/sample-book/book.py) in a
temporary folder, never the Lender's data, then prints each figure the lessons use,
read from the app's own API on 19 Oct 2026 (or on the date a lesson names).

    cd backend && uv run python ../docs/onboarding/001-what-the-app-does/scripts/check_figures.py

Amounts print in rupees (the API works in paise).
"""

import sys
import tempfile
from datetime import date, datetime, time
from pathlib import Path

from fastapi.testclient import TestClient

REPO = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(REPO / "docs" / "sample-book"))

import book  # noqa: E402

from mortgage_backend.main import create_app  # noqa: E402

THE_DAY = book.THE_DAY


def rs(paise: int) -> str:
    return f"₹{paise / 100:,.2f}"


def main() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        folder = Path(tmp)
        book.write(folder)
        app = create_app(
            f"sqlite:///{folder / 'data' / 'mortgage.db'}",
            today=lambda: THE_DAY,
            now=lambda: datetime.combine(THE_DAY, time(11, 0)),
            backup_dir=folder / "backups",
        )
        with TestClient(app) as api:
            report(api)


def report(api: TestClient) -> None:
    names = {}
    for status in ("active", "redeemed", "waived", "forfeited"):
        for m in api.get("/api/mortgages", params={"status": status, "limit": 100}).json()["items"]:
            names[m["name"]] = (m["id"], status)

    def mortgage(name_start: str) -> dict:
        name = next(n for n in names if n.startswith(name_start))
        return api.get(f"/api/mortgages/{names[name][0]}").json()

    def owed(m: dict, on: str) -> int:
        quote = api.get(f"/api/mortgages/{m['id']}/outstanding-on-closure", params={"on": on})
        return quote.json()["total"] if quote.status_code == 200 else quote.text

    print("Mortgages:", {n: s for n, (i, s) in names.items()})
    for key in ("2025-Meera-GoldChain", "2025-Arjun-GoldRing", "2026-Meera", "2026-Kavita-Silver",
                "2026-Kavita-GoldCoin", "2026-Lakshmi", "2026-Farida", "2026-Imran", "2026-Sunita",
                "2026-Arjun"):
        m = mortgage(key)
        print(f"\n== {m['name']} · {m['description']} · {m['status']} · lent {rs(m['amount_lent'])}"
              f" {m['lent_through']} on {m['start_date']} · {m['terms']}")
        if m["term_changes"]:
            print("   term changes:", m["term_changes"])
        for step in m["ledger"]:
            print(f"   {step['on']} {step['event']:<16} {rs(step['amount']):>14}"
                  f"  principal {rs(step['principal']):>14}  unpaid {rs(step['unpaid_interest']):>12}"
                  f"  itd-days {step['interest_to_date_days']}")
        if m["status"] == "active":
            print("   Outstanding today:", rs(owed(m, THE_DAY.isoformat())))

    chain = mortgage("2025-Meera-GoldChain")

    preview = api.post(f"/api/mortgages/{chain['id']}/edit-preview", json={
        **{k: chain[k] for k in ("name", "start_date", "gross_weight_mg", "net_weight_mg",
                                 "purity_karat", "description")},
        "amount_lent": 90_000_00,
    })
    effect = preview.json()["mortgages"][0]
    print("\nLesson 5: Preview of the chain at ₹90,000: owed today",
          rs(effect["before"]["outstanding"]), "->", rs(effect["after"]["outstanding"]))
    print("   keys:", list(effect), {k: str(v)[:600] for k, v in effect.items() if k not in ("before", "after")})

    print("\nLesson 5: Call List:")
    for row in api.get("/api/call-list").json()["items"]:
        print("  ", row)
    print("\nLesson 5: Dashboard:", str(api.get("/api/dashboard").json())[:1200])
    print("\nLesson 5: chain History:")
    for h in api.get(f"/api/mortgages/{chain['id']}/history").json()[:20]:
        print("  ", h)
    print("\nNotices:", str(api.get("/api/notices").json())[:800])
    print("\nPayments:")
    for p in api.get("/api/payments", params={"limit": 100}).json()["items"]:
        print("  ", {k: p.get(k) for k in ("paid_on", "customer", "amount", "method", "voided", "void_reason",
                                           "allocations")})


if __name__ == "__main__":
    main()
