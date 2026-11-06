"""Checks every figure and message chapter 002 quotes, against the real app.

For the course's editors. Everything happens in temporary folders, never the Lender's
data. It prints:

  1. the Default Terms of a fresh database, and of the sample book;
  2. Meera's chain on 19 Oct 2026, and Lakshmi's necklace's Redemption (lesson 4's recheck);
  3. what book.py says when it is run into a folder that already holds a book;
  4. what a fresh app with a BACKUP_DIR writes there before anyone does anything.

    cd backend && uv run python ../docs/onboarding/002-find-your-way-and-run-it/scripts/run_throughs.py

Amounts print in rupees (the API works in paise). The check-yourself exercise is not
here: run it as the page says, with pytest.
"""

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


def rs(paise: int) -> str:
    return f"₹{paise / 100:,.0f}"


def served(folder: Path) -> TestClient:
    """The book as serve.py serves it: clock held on 19 Oct 2026."""
    return TestClient(
        create_app(
            f"sqlite:///{folder / 'data' / 'mortgage.db'}",
            today=lambda: THE_DAY,
            now=lambda: datetime.combine(THE_DAY, time(11, 0)),
            backup_dir=folder / "backups",
        )
    )


def main() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        folder = Path(tmp)

        print("1. Default Terms")
        fresh = folder / "fresh"
        with TestClient(create_app(f"sqlite:///{fresh / 'mortgage.db'}")) as api:
            print("   fresh database:", api.get("/api/settings/default-terms").json())
        book.write(folder / "book")
        with served(folder / "book") as api:
            print("   sample book:   ", api.get("/api/settings/default-terms").json())

            print("2. Meera's chain on", THE_DAY)
            chain = next(
                m
                for m in api.get("/api/mortgages", params={"limit": 100}).json()["items"]
                if m["name"] == "2025-Meera-GoldChainPendant"
            )
            m = api.get(f"/api/mortgages/{chain['id']}").json()
            month = next(s for s in reversed(m["ledger"]) if s["event"] == "interest")
            to_date = m["ledger"][-1]
            print("   id:", m["id"], "  as_of:", m["as_of"])
            print("   a month's interest:", rs(month["amount"]), "on", month["on"])
            print(
                "   Interest to Date:", rs(to_date["amount"]),
                f"({to_date['interest_to_date_days']} days)",
            )
            print("   Outstanding:", rs(m["outstanding"]["total"]), m["outstanding"])

            print("   Lakshmi's necklace")
            necklace = next(
                m
                for m in api.get(
                    "/api/mortgages", params={"status": "redeemed", "limit": 100}
                ).json()["items"]
                if m["name"] == "2026-Lakshmi-TempleNecklace"
            )
            closure = api.get(f"/api/mortgages/{necklace['id']}").json()["closure"]
            print("   id:", necklace["id"], "  closure:", closure["kind"], "on", closure["on"])
            print(
                "   paid:", rs(closure["payment_amount"]),
                "  of which Interest to Date:", rs(closure["interest_to_date"]),
                f"({closure['interest_to_date_days']} days)",
            )

        print("3. book.py into a folder that already holds a book")
        try:
            book.write(folder / "book")
        except AssertionError as refused:
            print("  ", refused)

        print("4. A fresh app's BACKUP_DIR, after starting and one request")
        dev = folder / "dev"
        app = create_app(f"sqlite:///{dev / 'data' / 'mortgage.db'}", backup_dir=dev / "backups")
        with TestClient(app) as api:
            api.get("/api/settings/default-terms")
            app.state.backups.wait(timeout=8)
        print("  ", sorted(p.name for p in (dev / "backups").iterdir()))


if __name__ == "__main__":
    main()
