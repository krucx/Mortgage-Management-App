"""Golden Lending Book: deep-lifecycle fixture for QA.

Extends the shape of `docs/sample-book/book.py` into a richer book covering Advance
payments, instalment cancellation, closure/reopen, Grace periods, and call notes, for
the three customers named in the QA plan. Amounts in paise.

    cd backend && uv run python ../qa/fixtures/golden_book.py <folder>

writes <folder>/data (database + photos). Importable as `from qa.fixtures.golden_book import build`.
"""

import io
import sys
from datetime import date, datetime, time, timedelta
from pathlib import Path
from typing import Any

from fastapi.testclient import TestClient
from PIL import Image, ImageDraw

from mortgage_backend.main import create_app

RUPEE = 100
G = 1000


def rupees(amount: float) -> int:
    return round(amount * RUPEE)


class Clock:
    def __init__(self, day: date) -> None:
        self.day = day

    def today(self) -> date:
        return self.day

    def now(self) -> datetime:
        return datetime.combine(self.day, time(10, 30))


def portrait(skin: str, shirt: str, hair: str) -> bytes:
    image = Image.new("RGB", (240, 240), "#ece6dc")
    draw = ImageDraw.Draw(image)
    draw.ellipse((40, 150, 200, 300), fill=shirt)
    draw.ellipse((80, 52, 160, 140), fill=skin)
    draw.chord((78, 46, 162, 120), 180, 360, fill=hair)
    out = io.BytesIO()
    image.save(out, "JPEG", quality=90)
    return out.getvalue()


class Book:
    def __init__(self, folder: Path) -> None:
        self.clock = Clock(date(2025, 9, 1))
        data = folder / "data"
        data.mkdir(parents=True, exist_ok=True)
        self.app = create_app(
            f"sqlite:///{data / 'mortgage.db'}", today=self.clock.today, now=self.clock.now
        )
        self.api = TestClient(self.app, base_url="http://localhost")
        self.people: dict[str, Any] = {}
        self.mortgages: dict[str, Any] = {}

    def on(self, day: str) -> "Book":
        target = date.fromisoformat(day)
        assert target >= self.clock.day
        while self.clock.day < target:
            self.clock.day += timedelta(days=1)
        return self

    def get(self, path: str, **params: Any) -> Any:
        r = self.api.get(path, params=params)
        assert r.status_code == 200, f"GET {path}: {r.text}"
        return r.json()

    def post(self, path: str, body: Any = None) -> Any:
        r = self.api.post(path, json=body) if body is not None else self.api.post(path)
        assert r.status_code in (200, 201), f"POST {path}: {r.text}"
        return r.json()

    def put(self, path: str, body: Any) -> Any:
        r = self.api.put(path, json=body)
        assert r.status_code == 200, f"PUT {path}: {r.text}"
        return r.json()

    def upload(self, path: str, content: bytes, method: str = "post") -> Any:
        files = {"photo": ("photo.jpg", content, "image/jpeg")}
        r = getattr(self.api, method)(path, files=files)
        assert r.status_code in (200, 201), f"{path}: {r.text}"
        return r.json()

    def customer(self, key: str, name: str, phone: str, address: str, **fields: Any) -> None:
        self.people[key] = self.post("/api/customers", {"name": name, "address": address, "phone_1": phone, **fields})

    def lend(self, key: str, who: str, amount: float, description: str, net_g: float, gross_g: float,
             karat: int = 22, terms: Any = None, lent_through: str = "upi", started: str | None = None) -> None:
        body = {
            "customer_id": self.people[who]["id"],
            "start_date": started or self.clock.day.isoformat(),
            "amount_lent": rupees(amount),
            "description": description,
            "gross_weight_mg": round(gross_g * G),
            "net_weight_mg": round(net_g * G),
            "purity_karat": karat,
            "lent_through": lent_through,
            "terms": terms,
        }
        self.mortgages[key] = self.post("/api/mortgages", body)

    def pay(self, who: str, split: dict[str, float], method: str = "cash", reference: str | None = None,
            on: str | None = None, received_on: str | None = None, advance_months: int | None = None) -> Any:
        allocations = []
        for k, amount in split.items():
            a = {"mortgage_id": self.mortgages[k]["id"], "amount": rupees(amount)}
            if advance_months:
                a["advance"] = rupees(amount)
                a["months"] = advance_months
                a["amount"] = 0
            allocations.append(a)
        total = sum(a["amount"] + a.get("advance", 0) for a in allocations)
        return self.post("/api/payments", {
            "customer_id": self.people[who]["id"],
            "paid_on": on or self.clock.day.isoformat(),
            "received_on": received_on,
            "amount": total,
            "method": method,
            "reference": reference,
            "allocations": allocations,
        })

    def mortgage_id(self, key: str) -> int:
        return int(self.mortgages[key]["id"])


def events(book: Book) -> list[tuple[str, Any]]:
    ramesh, priya, meera = "ramesh", "priya", "meera"
    happened: list[tuple[str, Any]] = [
        ("2025-09-01", lambda: (
            book.customer(ramesh, "Ramesh Kumar", "9811122233", "12 MG Road, Bengaluru"),
            book.customer(priya, "Priya Sharma", "9822233344", "5 Park Street, Kolkata"),
            book.customer(meera, "Meera Sharma", "9833344455", "14 Lajpat Nagar, New Delhi"),
        )),
        ("2025-09-05", lambda: book.lend("r1", ramesh, 50_000, "Gold ring", net_g=5, gross_g=5.5)),
        ("2025-09-05", lambda: book.lend("r2", ramesh, 30_000, "Gold chain", net_g=3, gross_g=3.3)),
        ("2025-09-05", lambda: book.lend("p1", priya, 40_000, "Gold bangles", net_g=8, gross_g=8.8)),
        ("2025-09-05", lambda: book.lend("m1", meera, 60_000, "Gold necklace", net_g=12, gross_g=13.2)),
        # Ramesh: advance payment across 3 months on r1
        ("2025-09-10", lambda: book.pay(ramesh, {"r1": 15_000}, method="upi", advance_months=3,
                                         reference="UPI advance Ramesh")),
        # Ramesh: cancel the first upcoming instalment of r1
        ("2025-09-20", lambda: book.post(
            f"/api/mortgages/{book.mortgage_id('r1')}/advance-instalments/"
            f"{book.get(f'/api/mortgages/{book.mortgage_id('r1')}')['advance_instalments'][0]['id']}/cancel")),
        # Priya: advance payment then closure
        ("2025-09-12", lambda: book.pay(priya, {"p1": 12_000}, method="cash", advance_months=2,
                                         reference="cash advance Priya")),
        ("2025-10-01", lambda: book.on("2025-10-01")),
        ("2025-10-15", lambda: book.post(f"/api/mortgages/{book.mortgage_id('p1')}/redeem",
                                         {"redeemed_on": "2025-10-15", "method": "cash", "reference": "closure Priya"})),
        ("2025-10-20", lambda: book.post(f"/api/mortgages/{book.mortgage_id('p1')}/reopen",
                                         {"reason": "reopen for QA"})),
        # Meera: grace period payment (received late)
        ("2025-10-07", lambda: book.pay(meera, {"m1": 2_000}, method="upi", on="2025-10-04",
                                         received_on="2025-10-07", reference="grace Meera")),
        ("2025-11-01", lambda: book.post(f"/api/mortgages/{book.mortgage_id('m1')}/call-notes",
                                         {"note": "Will pay after festival"})),
    ]
    return happened


def build(folder: Path) -> None:
    book = Book(folder)
    with book.api:
        book.put("/api/settings/default-terms", {
            "monthly_rate_bps": 200, "interest_mode": "compounded_yearly", "part_month_rule": "pro_rata"})
        book.put("/api/settings/grace-period", {"grace_period_days": 3})
        for day, action in sorted(events(book), key=lambda e: e[0]):
            book.on(day)
            action()
        book.on("2025-11-15")


def write(folder: Path) -> None:
    build(folder)


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print(__doc__)
        sys.exit(1)
    write(Path(sys.argv[1]))