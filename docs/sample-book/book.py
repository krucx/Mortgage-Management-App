"""The Gold Chain Story's sample book: every person and figure the GitHub Pages screenshots
show, made through the app's own API, day by day, as the Lender would have made it. Each
change is made on its own date (the clock moves forward through the year), so the app
refuses anything it would have refused then, and every check a save runs is run.

Invented throughout. The book ends on 19 Oct 2026, the day the story is told.

    cd backend && uv run python ../docs/sample-book/book.py <folder>

writes <folder>/data (the database and photos); serve.py serves it. Amounts in paise.
"""

import io
import sys
from datetime import date, datetime, time, timedelta
from pathlib import Path
from typing import Any

from fastapi.testclient import TestClient
from PIL import Image, ImageDraw

from mortgage_backend.main import create_app

THE_DAY = date(2026, 10, 19)
RUPEE = 100
G = 1000  # milligrams in a gram


def rupees(amount: float) -> int:
    return round(amount * RUPEE)


class Clock:
    """The app's today, moved forward as the book is written; changes at 10:30."""

    def __init__(self) -> None:
        self.day = date(2025, 6, 1)

    def today(self) -> date:
        return self.day

    def now(self) -> datetime:
        return datetime.combine(self.day, time(10, 30))


def portrait(skin: str, shirt: str, hair: str) -> bytes:
    """A plain head-and-shoulders picture, standing in for a Customer's photo."""
    image = Image.new("RGB", (240, 240), "#ece6dc")
    draw = ImageDraw.Draw(image)
    draw.ellipse((40, 150, 200, 300), fill=shirt)
    draw.ellipse((80, 52, 160, 140), fill=skin)
    draw.chord((78, 46, 162, 120), 180, 360, fill=hair)
    out = io.BytesIO()
    image.save(out, "JPEG", quality=90)
    return out.getvalue()


def ring_photo() -> bytes:
    """A gold ring with a ruby, on a jeweller's tray."""
    image = Image.new("RGB", (480, 360), "#2d2a33")
    draw = ImageDraw.Draw(image)
    draw.ellipse((150, 110, 330, 290), outline="#d4a72c", width=22)
    draw.ellipse((210, 70, 270, 130), fill="#b0182b", outline="#e9c46a", width=6)
    out = io.BytesIO()
    image.save(out, "JPEG", quality=90)
    return out.getvalue()


class Book:
    def __init__(self, folder: Path) -> None:
        self.clock = Clock()
        data = folder / "data"
        data.mkdir(parents=True, exist_ok=True)
        self.app = create_app(
            f"sqlite:///{data / 'mortgage.db'}", today=self.clock.today, now=self.clock.now
        )
        self.api = TestClient(self.app)
        self.people: dict[str, Any] = {}
        self.mortgages: dict[str, Any] = {}

    # Moving through the year

    def on(self, day: str) -> "Book":
        """Move the clock to `day`, handling the Notices the morning run queued up to then
        as the Lender would have: approved and sent."""
        target = date.fromisoformat(day)
        assert target >= self.clock.day, f"{day} is before {self.clock.day}"
        while self.clock.day < target:
            self.clock.day += timedelta(days=1)
            if self.clock.day < THE_DAY:
                self.send_notices()
        return self

    def send_notices(self) -> None:
        for status in ("awaiting_approval", "queued"):
            for notice in self.get("/api/notices", status=status)["items"]:
                if notice["accrues_on"] <= (self.clock.day + timedelta(days=1)).isoformat():
                    if status == "awaiting_approval":
                        self.post(f"/api/notices/{notice['id']}/approve")
                    self.post(f"/api/notices/{notice['id']}/sent")

    # Requests, refused at once if the app refuses one

    def get(self, path: str, **params: Any) -> Any:
        response = self.api.get(path, params=params)
        assert response.status_code == 200, f"GET {path}: {response.text}"
        return response.json()

    def post(self, path: str, body: Any = None) -> Any:
        response = self.api.post(path, json=body)
        assert response.status_code in (200, 201), f"POST {path}: {response.text}"
        return response.json()

    def put(self, path: str, body: Any) -> Any:
        response = self.api.put(path, json=body)
        assert response.status_code == 200, f"PUT {path}: {response.text}"
        return response.json()

    def upload(self, path: str, content: bytes, method: str = "post") -> Any:
        files = {"photo": ("photo.jpg", content, "image/jpeg")}
        response = getattr(self.api, method)(path, files=files)
        assert response.status_code in (200, 201), f"{path}: {response.text}"
        return response.json()

    # The Lender's actions

    def customer(self, key: str, name: str, phone: str, address: str, **fields: Any) -> None:
        self.people[key] = self.post(
            "/api/customers", {"name": name, "address": address, "phone_1": phone, **fields}
        )

    def lend(
        self,
        key: str,
        who: str,
        amount: float,
        description: str,
        net_g: float,
        gross_g: float,
        karat: int = 22,
        terms: Any = None,
    ) -> None:
        body = {
            "customer_id": self.people[who]["id"],
            "start_date": self.clock.day.isoformat(),
            "amount_lent": rupees(amount),
            "description": description,
            "gross_weight_mg": round(gross_g * G),
            "net_weight_mg": round(net_g * G),
            "purity_karat": karat,
            "terms": terms,
        }
        self.mortgages[key] = self.post("/api/mortgages", body)

    def pay(self, who: str, split: dict[str, float], method: str = "cash", reference: str | None = None,
            redeeming: list[str] | None = None) -> Any:
        allocations = [
            {"mortgage_id": self.mortgages[key]["id"], "amount": rupees(amount)}
            for key, amount in split.items()
        ]
        return self.post(
            "/api/payments",
            {
                "customer_id": self.people[who]["id"],
                "paid_on": self.clock.day.isoformat(),
                "amount": sum(a["amount"] for a in allocations),
                "method": method,
                "reference": reference,
                "allocations": allocations,
                "redeeming": [self.mortgages[key]["id"] for key in redeeming or []],
            },
        )

    def mortgage_id(self, key: str) -> int:
        return int(self.mortgages[key]["id"])

    def skip_notices_of(self, name: str) -> None:
        for status in ("awaiting_approval", "queued"):
            for notice in self.get("/api/notices", status=status)["items"]:
                if notice["customer"]["name"] == name:
                    self.post(f"/api/notices/{notice['id']}/skip")


def events(book: Book) -> list[tuple[str, Any]]:
    """What happened, by date: (day, what the Lender did). Replayed in date order."""
    meera, arjun = "meera", "arjun"
    happened: list[tuple[str, Any]] = [
        # Arjun, whom Meera referred: a ruby ring at 2.5% a month, Compounded Monthly.
        ("2025-06-15", lambda: (
            book.customer(arjun, "Arjun Patel", "9820023456", "22 Navrangpura, Ahmedabad",
                          referrer={"kind": "customer", "id": book.people[meera]["id"]}),
            book.upload(f"/api/customers/{book.people[arjun]['id']}/photo",
                        portrait("#a8754f", "#2f5d8a", "#1c1410"), method="put"),
            book.lend("ring", arjun, 60_000, "Gold ring with ruby", net_g=6, gross_g=6.8,
                      terms={"monthly_rate_bps": 250, "interest_mode": "compounded_monthly",
                             "part_month_rule": "pro_rata"}),
            book.upload(f"/api/mortgages/{book.mortgage_id('ring')}/photos", ring_photo()),
        )),
        ("2025-08-14", lambda: book.pay(arjun, {"ring": 3_000}, method="upi")),  # his only one
        # Meera's chain, the story's pledge: 2% a month on ₹80,000, accruing on the 10th.
        ("2025-11-10", lambda: book.lend("chain", meera, 80_000, "Gold chain with pendant",
                                         net_g=20, gross_g=21.5)),
        ("2026-01-15", lambda: book.put(f"/api/mortgages/{book.mortgage_id('chain')}", {
            **{k: book.get(f"/api/mortgages/{book.mortgage_id('chain')}")[k] for k in (
                "name", "start_date", "amount_lent", "gross_weight_mg", "net_weight_mg", "purity_karat")},
            "description": "Gold chain with Lakshmi pendant",
        })),
        # Kavita's coin and Lakshmi's temple necklace.
        ("2026-02-18", lambda: (
            book.customer("kavita", "Kavita Joshi", "9850056789", "31 Kothrud, Pune"),
            book.lend("coin", "kavita", 50_000, "Gold coin", net_g=10, gross_g=10, karat=24),
        )),
        ("2026-02-20", lambda: (
            book.customer("lakshmi", "Lakshmi Iyer", "9830034567", "5 Mylapore, Chennai"),
            book.lend("necklace", "lakshmi", 2_00_000, "Temple necklace", net_g=30, gross_g=34),
        )),
        # Meera's bangles.
        ("2026-04-25", lambda: book.lend("bangles", meera, 1_50_000, "Pair of bangles",
                                         net_g=30, gross_g=32)),
        # Farida, who pays every month, on the 12th.
        ("2026-05-12", lambda: (
            book.customer("farida", "Farida Khan", "9870078901", "7 Park Street, Kolkata"),
            book.lend("nosering", "farida", 30_000, "Gold nose ring", net_g=2.5, gross_g=2.8),
        )),
        # Imran's earrings: one Payment, then nothing.
        ("2026-06-10", lambda: (
            book.customer("imran", "Imran Qureshi", "9840045678", "9 Charminar Road, Hyderabad"),
            book.lend("earrings", "imran", 60_000, "Gold earrings", net_g=8, gross_g=9),
        )),
        ("2026-08-10", lambda: book.pay("imran", {"earrings": 2_000})),
        # Arjun's chain, and Sunita, who shares a family phone with Meera.
        ("2026-08-19", lambda: book.lend("arjunchain", arjun, 45_000, "Gold chain", net_g=12, gross_g=12.5)),
        ("2026-09-21", lambda: (
            book.customer("sunita", "Sunita Rao", "9860067890", "14 Lajpat Nagar, New Delhi",
                          phone_2="9810099999", referrer={"kind": "customer", "id": book.people[meera]["id"]}),
            book.lend("mangalsutra", "sunita", 35_000, "Mangalsutra", net_g=10, gross_g=11),
        )),
        # Kavita redeems her coin.
        ("2026-10-05", lambda: book.post(f"/api/mortgages/{book.mortgage_id('coin')}/redeem",
                                         {"redeemed_on": "2026-10-05", "method": "upi", "reference": "UPI 7781"})),
        # Imran defaulted: his earrings are sold.
        ("2026-10-10", lambda: book.post(f"/api/mortgages/{book.mortgage_id('earrings')}/forfeit", {
            "forfeited_on": "2026-10-10", "recovered_amount": rupees(52_000), "note": "Sold to Agarwal Jewellers"})),
        # ₹16,000 typed instead of ₹6,000: Voided, then the ₹6,000 recorded.
        ("2026-10-10", lambda: (
            book.post(f"/api/payments/{book.pay(meera, {'bangles': 16_000})['id']}/void",
                      {"reason": "Typed ₹16,000 instead of ₹6,000"}),
            book.pay(meera, {"bangles": 6_000}),
        )),
        # The bangles go to 1.5% a month from their next Accrual Date.
        ("2026-10-12", lambda: book.post(f"/api/mortgages/{book.mortgage_id('bangles')}/term-changes",
                                         {"effective_on": "2026-10-25", "monthly_rate_bps": 150})),
        # Lakshmi pays off her necklace; Farida comes in ₹180 short and it is let off.
        ("2026-10-16", lambda: (
            book.pay("lakshmi", {"necklace": 2_00_000}, method="bank_transfer", reference="NEFT final"),
            book.post(f"/api/mortgages/{book.mortgage_id('nosering')}/waive", {
                "waived_on": "2026-10-16", "amount_paid": rupees(30_500), "method": "cash",
                "note": "Pays every month; ₹180 let off"}),
        )),
        # The day of the story: today's Gold Rates, and Arjun called about his ring.
        ("2026-10-19", lambda: (
            book.put("/api/settings/gold-rates", [
                {"purity_karat": 24, "rate_per_gram": rupees(14_766)},
                {"purity_karat": 22, "rate_per_gram": rupees(13_536)},
                {"purity_karat": 20, "rate_per_gram": rupees(12_332)},
                {"purity_karat": 18, "rate_per_gram": rupees(11_075)},
                {"purity_karat": 14, "rate_per_gram": rupees(8_601)},
            ]),
            book.post(f"/api/mortgages/{book.mortgage_id('ring')}/call-notes", {"note": "Will pay after Diwali"}),
            book.skip_notices_of("Lakshmi Iyer"),  # she has paid in full
        )),
    ]
    # The monthly Payments.
    chain_methods = {12: "cash", 1: "upi", 2: "cash", 3: "upi", 5: "cash", 6: "upi", 7: "upi", 8: "cash"}
    for month, method in chain_methods.items():  # Meera missed April
        year = 2025 if month == 12 else 2026
        happened.append((f"{year}-{month:02d}-10", lambda m=method: book.pay(meera, {"chain": 1_600}, method=m)))
    happened.append(("2026-09-10", lambda: book.pay(meera, {"chain": 2_000, "bangles": 10_000}, method="upi",
                                                    reference="UPI 4419 0921 7731")))
    for month in (3, 4, 5):
        happened.append((f"2026-{month:02d}-18", lambda: book.pay("kavita", {"coin": 1_000}, method="upi")))
    for month in range(3, 10):
        happened.append((f"2026-{month:02d}-20", lambda: book.pay("lakshmi", {"necklace": 4_000},
                                                                  method="bank_transfer", reference="NEFT")))
    for month in range(6, 10):
        happened.append((f"2026-{month:02d}-12", lambda: book.pay("farida", {"nosering": 600})))
    return happened


def write(folder: Path) -> None:
    book = Book(folder)
    with book.api:
        # The Lender's rules, set once before lending anything, and Meera, introduced by
        # Ravi Verma, who isn't a Customer himself.
        book.put("/api/settings/default-terms", {
            "monthly_rate_bps": 200, "interest_mode": "compounded_yearly", "part_month_rule": "pro_rata"})
        book.put("/api/settings/call-list", {"months_unpaid": 3, "loan_to_value_pct": 85})
        messages = book.get("/api/settings/messages")
        book.put("/api/settings/messages", {**messages, "notice_days_before": 2, "notice_approve_first": True})
        book.put("/api/settings/gold-rates", [
            {"purity_karat": karat, "rate_per_gram": rupees(rate)}
            for karat, rate in ((24, 14_200), (22, 13_000), (20, 11_850), (18, 10_650), (14, 8_280))
        ])
        book.customer(
            "meera", "Meera Sharma", "9810012345", "14 Lajpat Nagar, New Delhi", phone_2="9810099999",
            referrer={"kind": "new", "name": "Ravi Verma", "address": "", "phone": "9811122233"},
        )
        book.upload(f"/api/customers/{book.people['meera']['id']}/photo",
                    portrait("#c68e6a", "#b83a5e", "#2b1d14"), method="put")
        # Stable: events of one day keep the order they are listed in.
        for day, action in sorted(events(book), key=lambda event: event[0]):
            book.on(day)
            action()
        book.on(THE_DAY.isoformat())


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    write(Path(sys.argv[1]))
