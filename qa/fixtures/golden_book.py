"""The golden book: the lending book QA's browse scenarios read, made through the app's own
API with the sample book's helper (`lending_book.py`). It ends on 15 Nov 2025, the day
every golden scenario is set on, and it is read-only for scenarios: one that changes data
seeds its own Customer and Mortgages on the work app instead (qa/steps/lender.ts).

What it holds, for the screens to show: Payments split across Mortgages, a Discount, a
Grace Payment, Advances (upcoming, applied, cancelled), Redeemed, Waived, Forfeited and
Reopened Mortgages, a Dormant one, a Term Change, Gold Rates and a Collateral Value set by
hand, a Standalone Referrer, Call Notes, and Reminders awaiting approval, queued, sent and
skipped. Invented throughout. Amounts in paise.

    cd backend && uv run python ../qa/fixtures/golden_book.py <folder>

writes <folder>/data (the database and photos).
"""

import sys
from datetime import date
from pathlib import Path
from typing import Any

from lending_book import Book, Share, rupees

THE_DAY = date(2025, 11, 15)


def reminder_to(book: Book, name: str) -> int:
    """The id of today's Reminder to the Customer called `name`, awaiting approval."""
    found = [r["id"] for r in book.get("/api/reminders", status="awaiting_approval")["items"]
             if r["customer"]["name"] == name]
    assert len(found) == 1, f"expected one Reminder to {name} awaiting approval, found {found}"
    return found[0]


def events(book: Book) -> list[tuple[str, Any]]:
    """What happened, by date: (day, what the Lender did). Replayed in date order."""
    def mortgage(key: str) -> str:
        return f"/api/mortgages/{book.mortgage_id(key)}"

    happened: list[tuple[str, Any]] = [
        ("2025-09-01", lambda: (
            book.customer("ramesh", "Ramesh Kumar", "9811122233", "12 MG Road, Bengaluru"),
            book.customer("priya", "Priya Sharma", "9822233344", "5 Park Street, Kolkata"),
            book.customer("meera", "Meera Sharma", "9833344455", "14 Lajpat Nagar, New Delhi"),
            book.customer("rohit", "Rohit Verma", "9844455566", "3 Civil Lines, Jaipur"),
            book.customer("vikram", "Vikram Singh", "9855566677", "21 Sector 17, Chandigarh"),
            book.customer("anita", "Anita Desai", "9866677788", "8 Koregaon Park, Pune"),
        )),
        # Rohit defaulted: his earrings are sold.
        ("2025-09-03", lambda: book.lend("rohit", "rohit", 40_000, "Gold earrings", net_g=6, gross_g=6.6)),
        ("2025-09-05", lambda: (
            book.lend("r1", "ramesh", 50_000, "Gold ring", net_g=5, gross_g=5.5),
            book.lend("r2", "ramesh", 30_000, "Gold chain", net_g=3, gross_g=3.3),
            book.lend("p1", "priya", 40_000, "Gold bangles", net_g=8, gross_g=8.8),
            book.lend("m1", "meera", 60_000, "Gold necklace", net_g=12, gross_g=13.2),
        )),
        ("2025-09-08", lambda: book.lend("coin", "vikram", 50_000, "Gold coin", net_g=10, gross_g=10, karat=24)),
        ("2025-09-12", lambda: book.lend("bracelet", "anita", 25_000, "Gold bracelet", net_g=4, gross_g=4.4)),
        # Advances: Ramesh's ring over 3 months (its 5 Oct part cancelled, 5 Nov applied,
        # 5 Dec upcoming), his chain over 2 (both applied), Priya's bangles over 2.
        ("2025-09-10", lambda: book.pay("ramesh", {"r1": Share(advance=15_000, months=3)}, method="upi",
                                        reference="UPI advance Ramesh")),
        ("2025-09-11", lambda: book.pay("ramesh", {"r2": Share(advance=6_000, months=2)},
                                        reference="cash advance r2")),
        ("2025-09-12", lambda: book.pay("priya", {"p1": Share(advance=12_000, months=2)},
                                        reference="cash advance Priya")),
        ("2025-09-20", lambda: book.post(
            f"{mortgage('r1')}/advance-instalments/{book.get(mortgage('r1'))['advance_instalments'][0]['id']}/cancel")),
        # Meera's Grace Payment: received 7 Oct, within three days of the 5 Oct Accrual Date,
        # dated 4 Oct.
        ("2025-10-07", lambda: book.pay("meera", {"m1": 2_000}, method="upi", on="2025-10-04",
                                        received_on="2025-10-07", reference="grace Meera")),
        ("2025-10-08", lambda: book.lend("m2", "meera", 20_000, "Gold earrings", net_g=3, gross_g=3.2)),
        # Ramesh pays across both his Mortgages, with ₹100 off the chain.
        ("2025-10-10", lambda: book.pay("ramesh", {"r1": 1_000, "r2": Share(cash=500, discount=100)},
                                        reference="split Ramesh")),
        # Priya's bangles Redeemed, then Reopened: Redeemed by mistake.
        ("2025-10-15", lambda: book.post(f"{mortgage('p1')}/redeem", {
            "redeemed_on": "2025-10-15", "method": "cash", "reference": "closure Priya"})),
        ("2025-10-20", lambda: book.post(f"{mortgage('p1')}/reopen", {"reason": "reopen for QA"})),
        # Farhan's pendant goes to 1.5% a month from 16 Nov; Kiran's kada is valued by hand;
        # Deepa was introduced by Gopal Rao, who isn't a Customer himself.
        ("2025-10-16", lambda: (
            book.customer("farhan", "Farhan Ali", "9877788899", "4 Hazratganj, Lucknow"),
            book.lend("pendant", "farhan", 35_000, "Gold pendant", net_g=5, gross_g=5.4),
        )),
        ("2025-10-17", lambda: (
            book.customer("deepa", "Deepa Nair", "9888899900", "17 MG Road, Kochi",
                          referrer={"kind": "new", "name": "Gopal Rao", "address": "", "phone": "9899900011"}),
            book.lend("anklet", "deepa", 20_000, "Gold anklet", net_g=4, gross_g=4.5),
            book.customer("kiran", "Kiran Rao", "9800011122", "6 Jubilee Hills, Hyderabad"),
            book.lend("kada", "kiran", 45_000, "Gold kada", net_g=7, gross_g=7.5),
        )),
        ("2025-11-01", lambda: (
            book.post(f"{mortgage('pendant')}/term-changes", {"effective_on": "2025-11-16", "monthly_rate_bps": 150}),
            book.put(f"{mortgage('kada')}/collateral", {"value": rupees(60_000)}),
            book.post(f"{mortgage('m1')}/call-notes", {"note": "Will pay after festival"}),
        )),
        ("2025-11-03", lambda: book.post(f"{mortgage('rohit')}/forfeit", {
            "forfeited_on": "2025-11-03", "recovered_amount": rupees(38_000), "note": "Sold to Mehta Jewellers"})),
        ("2025-11-08", lambda: book.post(f"{mortgage('coin')}/redeem", {
            "redeemed_on": "2025-11-08", "method": "upi", "reference": "UPI closure Vikram"})),
        # Sunil's anklet, lent in cash on 1 Jul and entered late from the paper book with
        # its three Payments: together they leave it owing nothing, Dormant. (None of them is
        # its whole Outstanding on its date: that would Redeem it.)
        ("2025-11-10", lambda: (
            book.customer("sunil", "Sunil Mehta", "9811100022", "2 Ashram Road, Ahmedabad"),
            book.lend("sunil", "sunil", 15_000, "Silver-gold anklet", net_g=4, gross_g=5,
                      terms={"monthly_rate_bps": 200, "interest_mode": "simple", "part_month_rule": "nothing"},
                      lent_through="cash", started="2025-07-01"),
            book.pay("sunil", {"sunil": 300}, on="2025-08-26"),
            book.pay("sunil", {"sunil": 300}, on="2025-09-05"),
            book.pay("sunil", {"sunil": 15_000}, method="upi", on="2025-08-25"),
            # Meera pays her necklace and puts an Advance on her earrings, in one Payment.
            book.pay("meera", {"m1": 1_200, "m2": Share(advance=800, months=2)}, method="upi",
                     reference="split advance Meera"),
        )),
        # Anita comes in ₹200 short and it is let off.
        ("2025-11-12", lambda: book.post(f"{mortgage('bracelet')}/waive", {
            "waived_on": "2025-11-12", "amount_paid": book.owed("bracelet") - rupees(200),
            "method": "cash", "note": "₹200 let off"})),
        ("2025-11-14", lambda: book.post(f"{mortgage('pendant')}/call-notes", {"note": "Asked for a week"})),
        # The golden day: today's Gold Rates, and the Reminders for 16 and 17 Nov: Farhan's
        # approved (queued), Kiran's skipped, Deepa's still awaiting approval. Every earlier
        # one was sent.
        ("2025-11-15", lambda: (
            book.put("/api/settings/gold-rates", [
                {"purity_karat": karat, "rate_per_gram": rupees(rate)}
                for karat, rate in ((24, 12_600), (22, 11_550), (20, 10_500), (18, 9_450), (14, 7_350))
            ]),
            book.post(f"/api/reminders/{reminder_to(book, 'Farhan Ali')}/approve"),
            book.post(f"/api/reminders/{reminder_to(book, 'Kiran Rao')}/skip"),
        )),
    ]
    return happened


def write(folder: Path) -> None:
    book = Book(folder, start=date(2025, 9, 1), story_day=THE_DAY)
    with book.api:
        book.put("/api/settings/default-terms", {
            "monthly_rate_bps": 200, "interest_mode": "compounded_yearly", "part_month_rule": "pro_rata"})
        book.put("/api/settings/grace-period", {"grace_period_days": 3})
        messages = book.get("/api/settings/messages")
        book.put("/api/settings/messages", {**messages, "reminder_days_before": 2, "reminder_approve_first": True})
        book.put("/api/settings/gold-rates", [
            {"purity_karat": karat, "rate_per_gram": rupees(rate)}
            for karat, rate in ((24, 11_900), (22, 10_900), (20, 9_900), (18, 8_900), (14, 6_950))
        ])
        book.replay(events(book))


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    write(Path(sys.argv[1]))
