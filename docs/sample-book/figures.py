"""Fills in every figure the walkthrough and the story quote from the sample book
(book.py), as it stood on 19 Oct 2026, so none is typed by hand and none can drift:

    cd backend && uv run python ../docs/sample-book/figures.py <folder>

Run it while serve.py serves the book (after its first Backup) and before shots.mjs,
whose last scenes change the book.

A figure is marked on the pages as an element holding only text,
`<b data-fig="dashboard.owed">₹4,02,524</b>`, or, for markup, between
`<!-- fig:name -->` and `<!-- /fig:name -->`. Each is worked out through the app's API
(its clock on the day of the story) or, for History counts, from the database. It fails
if a page marks a figure it can't fill, or a figure goes unused, so a run either fills
everything or changes nothing.
"""

import json
import re
import sys
from collections import Counter
from datetime import date, datetime, time
from html import escape
from pathlib import Path
from time import sleep
from typing import Any

from book import THE_DAY
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text

from mortgage_backend.main import create_app
from mortgage_backend.platform.money import format_inr

DOCS = Path(__file__).resolve().parents[1]
# The Calculator's inputs as its URL keeps them, shared with shots.mjs.
SIMULATION = json.loads((Path(__file__).parent / "simulation.json").read_text())
PAGES = [DOCS / "walkthrough.html", DOCS / "story.html"]
MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]
INTEREST_MODES = {
    "simple": "Simple",
    "compounded_yearly": "Compounded Yearly",
    "compounded_monthly": "Compounded Monthly",
}
PART_MONTH_RULES = {"pro_rata": "pro-rata", "full_month": "full month", "nothing": "nothing"}


def day(on: str | date) -> str:
    """As the app writes a date: 19 Oct 2026."""
    on = date.fromisoformat(on) if isinstance(on, str) else on
    return f"{on.day} {MONTHS[on.month - 1]} {on.year}"


def month(on: str) -> str:
    """A month as prose names it, from an ISO date or month: June 2025."""
    return f"{MONTH_NAMES[int(on[5:7]) - 1]} {on[:4]}"


def percent(ratio: float) -> str:
    """As the app writes a ratio: 36.3%."""
    return f"{round(ratio * 100, 1):g}%"


def rate(bps: int) -> str:
    return f"{bps / 100:g}%"


def plural(n: int, one: str, many: str | None = None) -> str:
    return f"{n} {one if n == 1 else many or one + 's'}"


def short_inr(paise: int) -> str:
    """A bar's label: 50k, 2.19L."""
    rupees = paise / 100
    return f"{rupees / 1_00_000:.3g}L" if rupees >= 1_00_000 else f"{rupees / 1000:.3g}k"


class ServedBook:
    """The sample book as served on the day of the story."""

    def __init__(self, folder: Path) -> None:
        database = f"sqlite:///{folder / 'data' / 'mortgage.db'}"
        self.engine = create_engine(database)
        self.api = TestClient(
            create_app(
                database,
                today=lambda: THE_DAY,
                now=lambda: datetime.combine(THE_DAY, time(11, 0)),
            )
        )

    def get(self, path: str, **params: Any) -> Any:
        response = self.api.get(path, params=params)
        assert response.status_code == 200, f"GET {path}: {response.text}"
        return response.json()

    def post(self, path: str, body: Any) -> Any:
        response = self.api.post(path, json=body)
        assert response.status_code == 200, f"POST {path}: {response.text}"
        return response.json()

    def every(self, path: str, **params: Any) -> list[Any]:
        """Every item of a paged list."""
        items: list[Any] = []
        page = 1
        while True:
            listed = self.get(path, page=page, **params)
            items += listed["items"]
            if len(items) >= listed["total"]:
                return items
            page += 1

    def changes(self) -> Counter[str]:
        """How many changes the History holds, by action (a change's fields together)."""
        with self.engine.connect() as conn:
            rows = conn.execute(
                text("SELECT DISTINCT entity, entity_id, action, at FROM audit_entry")
            ).all()
        return Counter(row.action for row in rows)

    def last_backup(self) -> str:
        """When the served book's first Backup was taken, once it is."""
        for _ in range(120):
            taken = self.get("/api/backups")["last_backup_at"]
            if taken:
                return str(taken)
            sleep(0.5)
        raise AssertionError("serve.py took no Backup")

    def call_notes(self) -> int:
        with self.engine.connect() as conn:
            return int(conn.execute(text("SELECT count(*) FROM call_note")).scalar_one())


def paise(rupees: str) -> int:
    """Rupees as the Calculator's URL holds them ("20000") in paise."""
    return int(rupees) * 100


def calculator(book: ServedBook, terms: dict[str, Any], rates: dict[int, Any]) -> dict[str, str]:
    """The figures of the Calculator's sample Simulation (simulation.json), under its
    Terms and the Terms compared with them, as the Calculator works them out."""
    inputs = SIMULATION
    # The story tells it as asked today, for a year, at the Default Terms.
    assert inputs["start"] == THE_DAY.isoformat(), "simulation.json: start on the day of the story"
    assert inputs["closed"] == THE_DAY.replace(year=THE_DAY.year + 1).isoformat(), "simulation.json: a year on"
    # "2027-04-19:5000,…", as the Calculator's URL keeps Lump Sums
    lumps = [lump.split(":") for lump in inputs["lumps"].split(",")]
    under = [
        {
            "monthly_rate_bps": round(float(inputs[f"rate{which}"]) * 100),
            "interest_mode": inputs[f"mode{which}"],
            "part_month_rule": inputs[f"rule{which}"],
        }
        for which in ("", "2")  # the Terms, then those compared
    ]
    assert under[0] == terms, "simulation.json: the first Terms are the Default Terms"
    first, second = (
        book.post(
            "/api/simulation",
            {
                "amount_lent": paise(inputs["amount"]),
                "start_date": inputs["start"],
                "closed_on": inputs["closed"],
                "terms": each,
                "span_months": int(inputs["span"]),
                "monthly_payment": paise(inputs["monthly"]),
                "lump_sums": [{"on": on, "amount": paise(amount)} for on, amount in lumps],
            },
        )
        for each in under
    )
    one, two = (rate(each["monthly_rate_bps"]) for each in under)
    lent = paise(inputs["amount"])
    # The Collateral Value the Calculator shows: worked out in the browser, as nothing
    # is stored; rounded half-up to the paisa, as a Mortgage's is.
    mg = round(float(inputs["net"]) * 1000)
    collateral = (2 * mg * rates[int(inputs["purity"])]["rate_per_gram"] + 1000) // 2000

    def both(figure: Any) -> str:
        return f"{figure(first)} at {one}, {figure(second)} at {two}"

    return {
        "calculator.ask": f"{format_inr(lent)} for a year, from {day(inputs['start'])} to {day(inputs['closed'])}",
        "calculator.plan": f"{format_inr(paise(inputs['monthly']))} a month, and "
        + " and ".join(f"{format_inr(paise(amount))} on {day(on)}" for on, amount in lumps),
        "calculator.compared": f"{two} a month",
        "calculator.paid-off": both(lambda s: day(s["paid_off_on"])),
        "calculator.interest": both(lambda s: format_inr(s["interest_earned"])),
        "calculator.first-month": format_inr(first["first_month_interest"]),
        "calculator.yearly": both(lambda s: percent(s["effective_annual_rate"])),
        "calculator.value": f"{inputs['net']} grams of {inputs['purity']}K is {format_inr(collateral)}",
        "calculator.ltv": percent(lent / collateral),
    }


def figures(book: ServedBook) -> dict[str, str]:
    """Every figure the pages quote, by name: text, or markup for `fig:` blocks."""
    dash = book.get("/api/dashboard")
    mortgages = {m["name"]: m for m in book.every("/api/mortgages")}
    payments = book.every("/api/payments", show_voided=True)
    customers = book.every("/api/customers")
    notices = book.every("/api/notices")
    call_list = book.get("/api/call-list")
    rows = [row for group in call_list["items"] for row in group["rows"]]
    dormant = book.every("/api/closures/dormant")
    terms = book.get("/api/settings/default-terms")
    rates = {r["purity_karat"]: r for r in book.get("/api/settings/gold-rates")}
    calls = book.get("/api/settings/call-list")
    messages = book.get("/api/settings/messages")
    changes = book.changes()
    backup = book.last_backup()

    def paid(mortgage: dict[str, Any]) -> list[str]:
        """The dates of a Mortgage's Payments, oldest first."""
        return [s["on"] for s in mortgage["ledger"] if s["event"] == "payment"]

    def mortgage(name: str) -> dict[str, Any]:
        return book.get(f"/api/mortgages/{mortgages[name]['id']}")

    ring = mortgage("2025-Arjun-GoldRingRuby")
    chain = mortgage("2025-Meera-GoldChainPendant")
    bangles = mortgage("2026-Meera-PairBangles")
    sunita = mortgage("2026-Sunita-Mangalsutra")
    [coming] = [c for c in bangles["term_changes"] if c["removable"]]
    split = [p for p in payments if len(p["mortgages"]) > 1 and not p["voided"]]
    kept = [p for p in payments if not p["voided"]]
    methods = Counter(p["method"] for p in kept)
    by_status = Counter(n["status"] for n in notices)
    owed = dash["principal_outstanding"] + dash["unpaid_interest"]
    horizon = {h["months"]: h for h in dash["projections"]}
    months_unpaid = [r for r in rows if "months_unpaid" in r["reasons"]]
    too_high = [r for r in rows if "loan_to_value" in r["reasons"]]

    found: dict[str, str] = {
        "dashboard.owed": format_inr(owed),
        "dashboard.spread": f"across {plural(dash['active_mortgages'], 'Mortgage')} and "
        f"{plural(dash['customers_with_active_mortgages'], 'Customer')}",
        "dashboard.active": plural(dash["active_mortgages"], "Active Mortgage"),
        "dashboard.customers": plural(dash["customers_with_active_mortgages"], "Customer"),
        "dashboard.principal": format_inr(dash["principal_outstanding"]),
        "dashboard.unpaid": f"plus {format_inr(dash['unpaid_interest'])} unpaid interest",
        "dashboard.collected": format_inr(dash["interest_collected_this_month"]),
        "dashboard.collected-year": f"this month · {format_inr(dash['interest_collected_this_year'])} this year",
        "dashboard.collateral": format_inr(dash["collateral_value"]),
        "dashboard.ltv": percent(dash["loan_to_value"]),
        "dashboard.ltv-tile": f"Loan-to-Value {percent(dash['loan_to_value'])}",
        "dashboard.follow": f"{dash['call_list_count']} · {dash['notices_to_send'] + dash['notices_to_approve']}",
        "dashboard.call-list": plural(dash["call_list_count"], "Mortgage"),
        "dashboard.redeemed": f"{dash['redeemed_this_month']} Redeemed",
        "dashboard.closed": f"{dash['waived_this_month']} Waived off · {dash['forfeited_this_month']} Forfeited",
        "dashboard.ahead-3": format_inr(horizon[3]["interest_accrued"]),
        "dashboard.ahead-6": format_inr(horizon[6]["interest_accrued"]),
        "dashboard.ahead-12": format_inr(horizon[12]["interest_accrued"]),
        "settings.terms": f"{rate(terms['monthly_rate_bps'])} a month, "
        f"{INTEREST_MODES[terms['interest_mode']]}, {PART_MONTH_RULES[terms['part_month_rule']]}",
        "settings.gold-24-22": f"{format_inr(rates[24]['rate_per_gram'])} / {format_inr(rates[22]['rate_per_gram'])} a gram",
        "settings.gold-rest": " / ".join(format_inr(rates[k]["rate_per_gram"]) for k in (20, 18, 14)),
        "settings.gold-updated": day(rates[22]["updated_on"]),
        "settings.call-list": f"{calls['months_unpaid']}+ Months Unpaid, or Loan-to-Value above "
        f"{calls['loan_to_value_pct']}%",
        "settings.notices": f"{plural(messages['notice_days_before'], 'day')} before, "
        + ("approved first" if messages["notice_approve_first"] else "sent without approval"),
        "settings.backup": f"{day(backup[:10])}, {backup[11:16]}",
        "customers.count": str(len(customers)),
        "customers.active": str(dash["customers_with_active_mortgages"]),
        "customers.photo": str(sum(1 for c in customers if c.get("photo_url"))),
        "mortgage.monthly": f"/mortgages/{ring['id']}",
        "mortgage.coming": f"/mortgages/{bangles['id']}",
        "mortgage.edit": f"/mortgages/{chain['id']}/edit",
        "mortgage.terms": f"/mortgages/{chain['id']}/terms",
        "mortgage.monthly-story": f"Mortgage {ring['id']} lent {format_inr(ring['amount_lent'])} in "
        f"{month(ring['start_date'])} and owes "
        f"{format_inr(ring['outstanding']['total'])} today",
        "mortgage.coming-story": f"on Mortgage {bangles['id']}, a Term Change is coming from "
        f"{day(coming['effective_on'])} ({rate(coming['terms']['monthly_rate_bps'])} a month)",
        "mortgage.monthly-name": f"Mortgage {ring['id']} · Compounded Monthly, {rate(ring['terms']['monthly_rate_bps'])}",
        "mortgage.monthly-owes": f"{format_inr(ring['amount_lent'])} → {format_inr(ring['outstanding']['total'])}",
        "mortgage.yearly-name": f"Mortgage {chain['id']} · Compounded Yearly, {rate(chain['terms']['monthly_rate_bps'])}",
        "mortgage.yearly-owes": f"{format_inr(chain['amount_lent'])} → {format_inr(chain['outstanding']['total'])}",
        "mortgage.paid-down": f"Mortgage {chain['id']} has had {plural(len(paid(chain)), 'Payment')}; "
        f"Mortgage {ring['id']} has had {len(paid(ring))}, the last in {month(paid(ring)[-1])}.",
        "payments.count": f"{len(payments)} ({sum(p['voided'] for p in payments)} Voided)",
        "payments.methods": " · ".join(str(methods[m]) for m in ("cash", "upi", "bank_transfer")),
        "payments.split": plural(len(split), "Payment") + " ("
        + " and ".join(f"{len(p['mortgages'])} ways" for p in split) + ")",
        "payments.split-path": f"/payments/{split[0]['id']}",
        "payments.split-ways": f"split {len(split[0]['mortgages'])} ways",
        "payments.day": day(THE_DAY),
        "follow.to-send": str(by_status["queued"] + by_status["awaiting_approval"]),
        "follow.sent": str(by_status["sent"]),
        "follow.listed": f"{plural(len(rows), 'Mortgage')}, {plural(call_list['total'], 'Customer')}",
        "follow.months-unpaid": str(len(months_unpaid)),
        "follow.ltv": str(len(too_high)),
        "follow.call-notes": str(book.call_notes()),
        "follow.months-example": f"{max(r['months_unpaid'] for r in months_unpaid)} mo",
        "follow.ltv-example": percent(max(r["loan_to_value"] for r in too_high)),
        "closures.close-path": f"/mortgages/{sunita['id']}",
        "closures.active": str(dash["active_mortgages"]),
        "closures.dormant": str(len(dormant)),
        "closures.dormant-path": f"/mortgages/{dormant[0]['id']}",
        "closures.redeemed": str(dash["redeemed_this_month"]),
        "closures.waived": str(dash["waived_this_month"]),
        "closures.forfeited": str(dash["forfeited_this_month"]),
        "history.created": str(changes["created"]),
        "history.term-changes": f"{changes['term_change_added']} · {changes['term_change_removed']}",
        "history.edits": str(changes["edited"]),
        "history.voids": f"{changes['voided']} · {changes['reopened']}",
        "history.photos": str(changes["photo_added"]),
        "book.day": day(THE_DAY),
    }
    found |= calculator(book, terms, rates)
    found["dashboard.bars"], found["dashboard.bars-note"] = bars(dash["payments_by_month"])
    return found


def bars(by_month: list[dict[str, Any]]) -> tuple[str, str]:
    """The Dashboard's last 12 months of Payments, as bars, and the line under them."""
    top = max(m["amount"] for m in by_month) or 1
    html = []
    for m in by_month:
        month = MONTHS[int(m["month"][5:]) - 1]
        label = f"<em>{short_inr(m['amount'])}</em>" if m["amount"] else ""
        height = f"{m['amount'] / top * 100:.1f}".rstrip("0").rstrip(".")
        html.append(f'<div class="bar">{label}<div style="height:{height}%"></div><span>{month[0]}</span></div>')
    first, last = by_month[0]["month"], by_month[-1]["month"]
    span = f"{MONTHS[int(first[5:7]) - 1]} {first[:4]} – {MONTHS[int(last[5:7]) - 1]} {last[:4]}"
    received = ", ".join(
        f"{format_inr(m['amount'])} in {MONTHS[int(m['month'][5:]) - 1]}" for m in by_month if m["amount"]
    )
    indent = "\n        "
    return indent + indent.join(html) + "\n      ", f"{span} · {received}."


TEXT = re.compile(r'(<(\w+)[^>]*\sdata-fig="([a-z0-9.-]+)"[^>]*>)([^<]*)(</\2>)')
BLOCK = re.compile(r"(<!-- fig:([a-z0-9.-]+) -->)(.*?)(<!-- /fig:\2 -->)", re.DOTALL)


def fill(html: str, found: dict[str, str], used: set[str], page: str) -> str:
    def text(match: re.Match[str]) -> str:
        name = match.group(3)
        assert name in found, f"{page}: no figure {name}"
        used.add(name)
        return match.group(1) + escape(found[name], quote=False) + match.group(5)

    def block(match: re.Match[str]) -> str:
        name = match.group(2)
        assert name in found, f"{page}: no figure {name}"
        used.add(name)
        return match.group(1) + found[name] + match.group(4)

    return BLOCK.sub(block, TEXT.sub(text, html))


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    book = ServedBook(Path(sys.argv[1]))
    with book.api:
        found = figures(book)
    used: set[str] = set()
    filled = {page: fill(page.read_text(), found, used, page.name) for page in PAGES}
    unused = sorted(set(found) - used)
    assert not unused, f"figures no page quotes: {', '.join(unused)}"
    for page, html in filled.items():
        page.write_text(html)
    print(f"{len(used)} figures filled in {', '.join(p.name for p in PAGES)}")
