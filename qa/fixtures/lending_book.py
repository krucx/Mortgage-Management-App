"""A lending book made through the app's own API, day by day, as the Lender would have made
it: the helper the sample book (`docs/sample-book/book.py`) and the golden book
(`qa/fixtures/golden_book.py`) tell their stories with. Each change is made on its own date
(the clock moves forward through the story), so the app refuses anything it would have
refused then, and every check a save runs is run. Amounts in paise.
"""

from collections.abc import Callable
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
from pathlib import Path
from typing import Any

from fastapi.testclient import TestClient

from mortgage_backend.main import create_app

RUPEE = 100
G = 1000  # milligrams in a gram


def rupees(amount: float) -> int:
    return round(amount * RUPEE)


class Clock:
    """The app's today, moved forward as the book is written; changes at 10:30."""

    def __init__(self, day: date) -> None:
        self.day = day

    def today(self) -> date:
        return self.day

    def now(self) -> datetime:
        return datetime.combine(self.day, time(10, 30))


@dataclass(frozen=True)
class Share:
    """One Mortgage's part of a Payment, in rupees: cash paid now, a Discount applied after
    it, and an Advance held for its next `months` of interest (ADR 0021)."""

    cash: float = 0
    discount: float = 0
    advance: float = 0
    months: int | None = None


class Book:
    def __init__(self, folder: Path, start: date, story_day: date) -> None:
        """A new book in `folder`/data, its clock on `start`. Until `story_day` the Lender
        approves and sends every Reminder as it comes due; from then on they are left as
        queued."""
        self.clock = Clock(start)
        self.story_day = story_day
        data = folder / "data"
        data.mkdir(parents=True, exist_ok=True)
        self.app = create_app(
            f"sqlite:///{data / 'mortgage.db'}", today=self.clock.today, now=self.clock.now
        )
        # The app answers only requests addressed to it as localhost.
        self.api = TestClient(self.app, base_url="http://localhost")
        self.people: dict[str, Any] = {}
        self.mortgages: dict[str, Any] = {}

    # Moving through the year

    def on(self, day: str) -> "Book":
        """Move the clock to `day`, handling the Reminders the morning run queued up to then
        as the Lender would have: approved and sent."""
        target = date.fromisoformat(day)
        assert target >= self.clock.day, f"{day} is before {self.clock.day}"
        while self.clock.day < target:
            self.clock.day += timedelta(days=1)
            if self.clock.day < self.story_day:
                self.send_reminders()
        return self

    def send_reminders(self) -> None:
        for status in ("awaiting_approval", "queued"):
            for reminder in self.get("/api/reminders", status=status)["items"]:
                if reminder["accrues_on"] <= (self.clock.day + timedelta(days=1)).isoformat():
                    if status == "awaiting_approval":
                        self.post(f"/api/reminders/{reminder['id']}/approve")
                    self.post(f"/api/reminders/{reminder['id']}/sent")

    def replay(self, events: list[tuple[str, Callable[[], Any]]]) -> None:
        """Do each (day, action) on its day, in date order, then move on to the story's day.
        Stable: events of one day keep the order they are listed in."""
        for day, action in sorted(events, key=lambda event: event[0]):
            self.on(day)
            action()
        self.on(self.story_day.isoformat())

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
        lent_through: str = "upi",
        started: str | None = None,
    ) -> None:
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

    def pay(
        self,
        who: str,
        split: dict[str, float | Share],
        method: str = "cash",
        reference: str | None = None,
        on: str | None = None,
        received_on: str | None = None,
    ) -> Any:
        """A Payment received today (or dated `on`, when entered late), split across the
        Customer's Mortgages: rupees in cash for each, or a Share. Dated `on` the day before
        an Accrual Date and `received_on` within its Grace Period, it is a Grace Payment. An
        Allocation of a Mortgage's whole Outstanding Redeems it."""
        allocations = []
        for key, part in split.items():
            share = part if isinstance(part, Share) else Share(cash=part)
            allocation: dict[str, Any] = {
                "mortgage_id": self.mortgages[key]["id"], "amount": rupees(share.cash)}
            if share.discount:
                allocation["discount"] = rupees(share.discount)
            if share.advance:
                allocation |= {"advance": rupees(share.advance), "months": share.months}
            allocations.append(allocation)
        return self.post(
            "/api/payments",
            {
                "customer_id": self.people[who]["id"],
                "paid_on": on or self.clock.day.isoformat(),
                "received_on": received_on,
                "amount": sum(a["amount"] + a.get("advance", 0) for a in allocations),
                "method": method,
                "reference": reference,
                "allocations": allocations,
            },
        )

    def mortgage_id(self, key: str) -> int:
        return int(self.mortgages[key]["id"])

    def owed(self, key: str) -> int:
        """What the Mortgage would take to close today: its Outstanding, in paise."""
        quote = self.get(f"/api/mortgages/{self.mortgage_id(key)}/outstanding-on-closure",
                         on=self.clock.day.isoformat())
        return int(quote["total"])
