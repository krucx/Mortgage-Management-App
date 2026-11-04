"""Checks every figure chapter 003 shows, against the real app.

For the course's editors. Builds the sample book in a temporary folder (never the
Lender's data), serves it as serve.py does (clock held on 19 Oct 2026), then makes the
four requests the reader watches in the Network tab, for Meera's new Payment:

  GET  /api/mortgages?customer_id=…&status=active&as_of=2026-10-19&paged=false
  POST /api/payments/preview
  POST /api/payments
  GET  /api/payments/{id}/receipt

It also prints her 10 Sep Payment (lesson 1), the rows the save wrote (lesson 3), and
two variations: the whole Outstanding (Redeems, lesson 4) and ₹1 more (refused).

    cd backend && uv run python ../Documentation/onboarding/003-one-payment-end-to-end/scripts/run_throughs.py

Amounts print in rupees (the API works in paise).
"""

import json
import sys
import tempfile
from datetime import datetime, time
from pathlib import Path

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text

REPO = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(REPO / "docs" / "sample-book"))

import book  # noqa: E402

from mortgage_backend.main import create_app  # noqa: E402

THE_DAY = book.THE_DAY
RUPEE = 100


def rs(paise: int | None) -> str:
    return "—" if paise is None else f"₹{paise / RUPEE:,.0f}"


def show_preview(preview: dict) -> None:
    for m in preview["mortgages"]:
        b, a = m["before"], m["after"]
        print(f"   {m['mortgage_name']}: owed today {rs(b['outstanding'])} → {rs(a['outstanding'])}"
              f"   closure after: {a['closure'] and a['closure']['kind']}")
    print("   cash:", preview["cash"])


def main() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        folder = Path(tmp)
        book.write(folder)
        db = folder / "data" / "mortgage.db"
        app = create_app(
            f"sqlite:///{db}",
            today=lambda: THE_DAY,
            now=lambda: datetime.combine(THE_DAY, time(11, 0)),
            backup_dir=folder / "backups",
        )
        with TestClient(app) as api:
            report(api, db)


def report(api: TestClient, db: Path) -> None:
    meera = next(
        c for c in api.get("/api/customers", params={"limit": 100}).json()["items"]
        if c["name"] == "Meera Sharma"
    )
    print("Meera's customer id:", meera["id"])

    print("\n1. Her 10 Sep Payment (lesson 1)")
    sep = next(
        p for p in api.get("/api/payments", params={"customer_id": meera["id"], "limit": 100}).json()["items"]
        if p["paid_on"] == "2026-09-10"
    )
    paid = api.get(f"/api/payments/{sep['id']}").json()
    print("   id", paid["id"], rs(paid["amount"]), paid["method"])
    for a in paid["allocations"]:
        print(f"   {a['mortgage_name']}: {rs(a['amount'])} = interest {rs(a['interest_paid'])}"
              f" + Principal {rs(a['principal_paid'])}")

    print("\n2. GET /api/mortgages (the form's list, as_of the Payment date)")
    listed = api.get("/api/mortgages", params={
        "customer_id": meera["id"], "status": "active", "as_of": THE_DAY.isoformat(), "paged": False,
    }).json()["items"]
    ids = {}
    for m in listed:
        ids[m["name"]] = m["id"]
        print(f"   id {m['id']} {m['name']}: Outstanding {rs(m['outstanding_total'])}")
    chain, bangles = ids["2025-Meera-GoldChainPendant"], ids["2026-Meera-PairBangles"]

    payment = {
        "customer_id": meera["id"],
        "paid_on": THE_DAY.isoformat(),
        "amount": 6_600 * RUPEE,
        "method": "upi",
        "reference": None,
        "allocations": [
            # In the form's order: the list is newest Mortgage first.
            {"mortgage_id": bangles, "amount": 5_000 * RUPEE},
            {"mortgage_id": chain, "amount": 1_600 * RUPEE},
        ],
    }
    print("\n   The body the form sends:", json.dumps(payment))

    print("\n3. POST /api/payments/preview")
    preview = api.post("/api/payments/preview", json=payment)
    print("   status", preview.status_code)
    show_preview(preview.json())
    for m in preview.json()["mortgages"]:
        for c in m["ledger_changes"]:
            step = c["after"] or c["before"]
            side = "after" if c["after"] else "before only"
            print(f"   {m['mortgage_name']} ledger change {c['on']} {c['event']} ({side}): amount {rs(step['amount'])},"
                  f" interest paid {rs(step['interest_paid'])}, Principal paid {rs(step['principal_paid'])},"
                  f" Principal {rs(step['principal'])}, unpaid {rs(step['unpaid_interest'])}")

    whole = next(m["outstanding_total"] for m in listed if m["id"] == chain)
    redeeming = {**payment, "amount": whole, "allocations": [{"mortgage_id": chain, "amount": whole}]}
    r = api.post("/api/payments/preview", json=redeeming)
    print(f"\n   Preview of the chain's whole Outstanding {rs(whole)} (lesson 2): status {r.status_code}")
    show_preview(r.json())

    with create_engine(f"sqlite:///{db}").connect() as conn:
        before = conn.execute(text("select max(id) from payment")).scalar()
        print("   rows after the Preview: max payment id still", before)

    print("\n4. POST /api/payments")
    saved = api.post("/api/payments", json=payment)
    print("   status", saved.status_code)
    body = saved.json()
    print("   id", body["id"])
    for a in body["allocations"]:
        print(f"   {a['mortgage_name']}: {rs(a['amount'])} = interest {rs(a['interest_paid'])}"
              f" + Principal {rs(a['principal_paid'])}")

    with create_engine(f"sqlite:///{db}").connect() as conn:
        for row in conn.execute(text(
            "select id, customer_id, paid_on, amount, method, reference, received_with"
            " from payment where id = :id"), {"id": body["id"]}):
            print("   payment row:", tuple(row))
        for row in conn.execute(text(
            "select id, payment_id, mortgage_id, amount from allocation where payment_id = :id"),
                {"id": body["id"]}):
            print("   allocation row:", tuple(row))
        for row in conn.execute(text(
            "select entity, entity_id, action, field, new_value from audit_entry"
            " where entity = 'payment' and entity_id = :id"), {"id": body["id"]}):
            print("   History row:", tuple(row))

    print("\n5. GET /api/payments/{id}/receipt")
    receipt = api.get(f"/api/payments/{body['id']}/receipt").json()
    print("   method", receipt["method"], " phones", receipt["phones"])
    for line in receipt["lines"]:
        print(f"   {line['description']}: paid {rs(line['paid'])}, interest {rs(line['interest_paid'])},"
              f" Principal {rs(line['principal_paid'])}, still owed {rs(line['owed_after'])}")
    print("   total owed", rs(receipt["total_owed"]))
    print("   --- WhatsApp text ---")
    print(receipt["text"])
    print("   ---")

    print("\n5b. A back-dated ₹2,000 to the chain on 15 Oct, saved after Payment 34 (lesson 4)")
    back = {**payment, "paid_on": "2026-10-15", "amount": 2_000 * RUPEE,
            "allocations": [{"mortgage_id": chain, "amount": 2_000 * RUPEE}]}
    r = api.post("/api/payments", json=back)
    print("   status", r.status_code, "id", r.json()["id"])
    again = api.get(f"/api/payments/{body['id']}").json()
    for a in again["allocations"]:
        print(f"   Payment {body['id']} now: {a['mortgage_name']}: {rs(a['amount'])} = interest {rs(a['interest_paid'])}"
              f" + Principal {rs(a['principal_paid'])}")
    with create_engine(f"sqlite:///{db}").connect() as conn:
        for row in conn.execute(text(
            "select id, payment_id, mortgage_id, amount from allocation where payment_id = :id"),
                {"id": body["id"]}):
            print("   its allocation row, unchanged:", tuple(row))
    void = api.post(f"/api/payments/{r.json()['id']}/void", json={"reason": "Course example, undone"})
    print("   Voided the back-dated one again:", void.status_code)
    again = api.get(f"/api/payments/{body['id']}").json()
    print("   Payment", body["id"], "chain split back to:",
          [(a["interest_paid"], a["principal_paid"]) for a in again["allocations"] if a["mortgage_id"] == chain])

    print("\n6. Variations on the chain alone (Preview only)")
    owed = next(m for m in api.get("/api/mortgages", params={
        "customer_id": meera["id"], "status": "active", "paged": False}).json()["items"]
        if m["id"] == chain)["outstanding_total"]
    for label, amount in (("whole Outstanding", owed), ("₹1 more", owed + RUPEE)):
        one = {**payment, "amount": amount, "allocations": [{"mortgage_id": chain, "amount": amount}]}
        r = api.post("/api/payments/preview", json=one)
        print(f"   {label} {rs(amount)}: status {r.status_code}")
        if r.status_code == 200:
            show_preview(r.json())
        else:
            print("  ", r.json())
        s = api.post("/api/payments", json=one) if label == "₹1 more" else None
        if s is not None:
            print(f"   saving it: status {s.status_code} {s.json()}")


if __name__ == "__main__":
    main()
