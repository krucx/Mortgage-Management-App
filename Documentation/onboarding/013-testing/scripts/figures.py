"""The figures chapter 013 quotes for the tests' cast, from the real app.

Run from backend/:  uv run python ../Documentation/onboarding/013-testing/scripts/figures.py

It builds the app as conftest.py's `client` fixture does (a fresh database in a temporary
folder, today 20 Apr 2026) and makes the tests' standard data with api_seed.py.
"""

import sys
import tempfile
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path.cwd() / "tests"))

from api_seed import lend, person  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from seed import RUPEE  # noqa: E402

from mortgage_backend.main import create_app  # noqa: E402

TODAY = date(2026, 4, 20)


def rupees(paise: int) -> str:
    return f"₹{paise / RUPEE:,.2f}"


with tempfile.TemporaryDirectory() as folder:
    url = f"sqlite:///{Path(folder) / 'mortgage.db'}"
    with TestClient(create_app(url, today=lambda: TODAY)) as client:
        print("== L2 the default lend(): Ramesh's chain, from 14 Jan 2026, SIMPLE_3")
        ramesh = person(client)
        chain = lend(client, ramesh)
        got = client.get(f"/api/mortgages/{chain['id']}").json()
        print(got["name"], "outstanding on 20 Apr:", {k: rupees(v) for k, v in got["outstanding"].items()})
        for step in got["ledger"]:
            print(" ", step["on"], step["event"], rupees(step["amount"]), "principal", rupees(step["principal"]), "unpaid", rupees(step["unpaid_interest"]))

        print("\n== L5 the reader's boundary: ₹6,000 a gram of 22K, 10.3 g, lent today")
        client.put("/api/settings/gold-rates", json=[{"purity_karat": 22, "rate_per_gram": 6_000 * RUPEE}])
        sita = person(client, "Sita Devi", "9829054321")
        for amount in (51_000, 51_001):
            m = lend(client, sita, "2026-04-20", amount * RUPEE, net_weight_mg=10_300)
            got = client.get(f"/api/mortgages/{m['id']}").json()
            print(f"lent ₹{amount:,}: owes", rupees(got["outstanding"]["total"]), "collateral", got["collateral"])
        rows = [r for g in client.get("/api/call-list").json()["items"] for r in g["rows"]]
        for r in rows:
            print(" listed:", r["mortgage_name"], r["reasons"], "LTV", r["loan_to_value"], "x100 =", r["loan_to_value"] * 100)

print("\n== 99 Ramesh pays ₹12,000 on 20 Apr to the default chain")
with tempfile.TemporaryDirectory() as folder:
    url = f"sqlite:///{Path(folder) / 'mortgage.db'}"
    with TestClient(create_app(url, today=lambda: TODAY)) as client:
        from api_seed import pay  # noqa: E402

        ramesh = person(client)
        chain = lend(client, ramesh)
        pay(client, ramesh, {chain["id"]: 12_000 * RUPEE}, on="2026-04-20")
        got = client.get(f"/api/mortgages/{chain['id']}").json()
        print("status", got["status"], "outstanding", {k: rupees(v) for k, v in got["outstanding"].items()})
        rows = [r for g in client.get("/api/call-list").json()["items"] for r in g["rows"]]
        print("call list:", [(r["mortgage_name"], r["reasons"]) for r in rows])
