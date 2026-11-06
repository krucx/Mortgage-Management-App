"""Checks every figure and message chapter 008 shows, against the real people, photo and
collateral code.

For the course's editors. Builds the sample book once in a temporary folder (never the
Lender's data), then works on fresh copies of its data folder (database and photos)
through the real API, held on 19 Oct 2026: one copy that is only read or Previewed, and
one per lesson that saves, so no change leaks into another section's figures.

    cd backend && uv run python ../docs/onboarding/008-people-and-collateral/scripts/run_throughs.py

Amounts print in rupees (the code works in paise). Each section is headed with the
lesson that quotes it (L1–L5, 99).
"""

import shutil
import sqlite3
import sys
import tempfile
from datetime import date, datetime, time
from io import BytesIO
from pathlib import Path

from fastapi.testclient import TestClient
from PIL import Image

REPO = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(REPO / "docs" / "sample-book"))

import book  # noqa: E402

from mortgage_backend.collateral.collateral import GoldRate, collateral_of  # noqa: E402
from mortgage_backend.main import create_app  # noqa: E402
from mortgage_backend.people.customers import normalise_phone, phone_fragment  # noqa: E402

THE_DAY = book.THE_DAY
RUPEE = 100
RING, CHAIN, COIN = 1, 2, 3


def rs(paise: int | None) -> str:
    if paise is None:
        return "None"
    return f"{paise / RUPEE:,.2f}".removesuffix(".00")


def jpeg(width: int, height: int, colour: str = "#d4a017", orientation: int | None = None) -> bytes:
    image = Image.new("RGB", (width, height), colour)
    out = BytesIO()
    if orientation is None:
        image.save(out, "JPEG")
    else:
        exif = Image.Exif()
        exif[0x0112] = orientation
        image.save(out, "JPEG", exif=exif)
    return out.getvalue()


class Copy:
    """A fresh copy of the built book's data folder, served by the real app on 19 Oct 2026."""

    def __init__(self, built: Path, name: str) -> None:
        self.folder = built.parent / name
        shutil.copytree(built, self.folder / "data")
        self.db = self.folder / "data" / "mortgage.db"
        self.photos = self.folder / "data" / "photos"
        app = create_app(f"sqlite:///{self.db}", today=lambda: THE_DAY,
                         now=lambda: datetime.combine(THE_DAY, time(11, 0)))
        self.api = TestClient(app)
        self.api.__enter__()

    def call(self, method: str, path: str, quiet: bool = False, **kw):
        r = getattr(self.api, method)("/api" + path, **kw)
        try:
            body = r.json() if r.content else None
        except ValueError:
            body = f"<{len(r.content)} bytes {r.headers.get('content-type')}>"
        detail = body.get("detail") if isinstance(body, dict) else None
        if isinstance(detail, list):
            detail = "; ".join(d["msg"] for d in detail)
        if not quiet:
            print(f"   {method.upper()} {path} -> {r.status_code}" + (f": {detail}" if detail else ""))
        return r.status_code, body

    def sql(self, query: str) -> None:
        with sqlite3.connect(self.db) as conn:
            cur = conn.execute(query)
            print("     sqlite>", " ".join(query.split()))
            print("     ", " | ".join(d[0] for d in cur.description))
            for row in cur.fetchall():
                print("     ", " | ".join("" if v is None else str(v) for v in row))

    def files(self) -> list[str]:
        return sorted(p.name for p in self.photos.iterdir())

    def customer(self, customer_id: int) -> dict:
        _, c = self.call("get", f"/customers/{customer_id}", quiet=True)
        return c

    def body_of(self, customer_id: int, **overrides) -> dict:
        """A CustomerIn body for an edit, from the Customer as they are now."""
        c = self.customer(customer_id)
        referrer = c["referrer"] and {"kind": c["referrer"]["kind"], "id": c["referrer"]["id"]}
        fields = ("name", "address", "phone_1", "phone_2", "email", "aadhaar_last4", "pan")
        return {**{k: c[k] for k in fields}, "referrer": referrer, **overrides}


def new(name: str, phone: str, **fields) -> dict:
    return {"name": name, "address": "1 Test Road", "phone_1": phone, **fields}


def show_referrer(c: dict) -> str:
    r = c["referrer"]
    return f"{c['name']} (id {c['id']}): referrer = " + (f"{r['kind']} {r['id']} {r['name']}" if r else "none")


def main() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        folder = Path(tmp) / "book"
        book.write(folder)
        report(folder / "data")


def report(built: Path) -> None:
    ro = Copy(built, "read-only")

    # ------------------------------------------------------------ cast
    print("\n== Cast: Customers and Standalone Referrers on 19 Oct 2026")
    ro.sql("SELECT id, name, phone_1, phone_2, referred_by_customer_id AS by_cust,"
           " referred_by_standalone_referrer_id AS by_ref, aadhaar_last4, pan FROM customer ORDER BY id")
    ro.sql("SELECT * FROM standalone_referrer")
    ids = {c["name"].split()[0]: c["id"] for c in ro.call("get", "/customers", quiet=True)[1]["items"]}
    meera, arjun, sunita = ids["Meera"], ids["Arjun"], ids["Sunita"]

    # ------------------------------------------------------------ lesson 1
    print("\n== L1. The Primary Number")
    for typed in ("+91 98100-12345", "098100 12345", "98100 12345", "(981) 001-2345", "98100", "+1 415 555 0100"):
        try:
            print(f"   normalise_phone({typed!r}) = {normalise_phone(typed)!r}")
        except ValueError as e:
            print(f"   normalise_phone({typed!r}) raises ValueError: {e}")
    print("   Meera as typed, through the Preview:")
    ro.call("post", "/customers/preview", json=new("Meera Sharma", "+91 98100-12345"))
    print("   Same name, another number:")
    ro.call("post", "/customers/preview", json=new("Meera Sharma", "9999911111"))
    print("   Someone else on Meera's family phone as their contact number 1:")
    ro.call("post", "/customers/preview", json=new("Rohan Sharma", "9810099999"))
    print("   Meera's family phone as someone's contact number 2:")
    ro.call("post", "/customers/preview", json=new("Rohan Sharma", "9999911111", phone_2="9810099999"))
    print("   Editing Arjun's contact number 1 to Meera's, then to Ravi's:")
    ro.call("put", f"/customers/{arjun}/preview", json=ro.body_of(arjun, phone_1="9810012345"))
    ro.call("put", f"/customers/{arjun}/preview", json=ro.body_of(arjun, phone_1="9811122233"))
    for cid in (meera, sunita):
        c = ro.customer(cid)
        print(f"   {c['name']}: phone_1 {c['phone_1']} phone_2 {c['phone_2']} shares_phone_with {c['shares_phone_with']}")
    for phone in ("9810012345", "+91 98111 22233", "9810099999", "98100", "9999911111"):
        _, who = ro.call("get", "/people/by-phone", quiet=True, params={"phone": phone})
        print(f"   GET /people/by-phone?phone={phone!r} -> {who}")
    for q in ("981", "98", "ravi", "Sharma", "98100 99999", "+91 98111", "9-8-1"):
        print(f"   phone_fragment({q!r}) = {phone_fragment(q)!r}")
        _, hits = ro.call("get", "/search", quiet=True, params={"q": q})
        print(f"     GET /search?q={q!r} -> {[(h['kind'], h['id'], h['name'], h['phone']) for h in hits]}")

    # ------------------------------------------------------------ lesson 2
    print("\n== L2. Referrers")
    print("  ", show_referrer(ro.customer(meera)))
    print("  ", show_referrer(ro.customer(arjun)))
    _, ravi = ro.call("get", "/referrers/1")
    print("   Ravi's page:", ravi)
    l2 = Copy(built, "l2")
    print("   Deepa, typed with a 'new' Referrer Ravi Verma 9811122233:")
    _, deepa = l2.call("post", "/customers", json=new(
        "Deepa Nair", "9822233344",
        referrer={"kind": "new", "name": "Ravi V.", "address": "", "phone": "+91 98111 22233"}))
    print("  ", show_referrer(deepa))
    l2.sql("SELECT * FROM standalone_referrer")
    print("   Ravi borrows: a new Customer on 9811122233. First, as his own Referrer three ways:")
    l2.call("post", "/customers/preview", json=new("Ravi Verma", "9811122233", referrer={"kind": "referrer", "id": 1}))
    l2.call("post", "/customers/preview", json=new(
        "Ravi Verma", "9811122233", referrer={"kind": "new", "name": "Ravi", "address": "", "phone": "9811122233"}))
    l2.call("put", f"/customers/{meera}/preview", json=l2.body_of(meera, referrer={"kind": "customer", "id": meera}))
    print("   The edit way round: Arjun takes Ravi's number:")
    l2.call("put", f"/customers/{arjun}/preview", json=l2.body_of(arjun, phone_1="9811122233"))
    print("   Then for real:")
    _, ravi_c = l2.call("post", "/customers", json=new("Ravi Verma", "9811122233", address="3 Defence Colony, New Delhi"))
    print("  ", show_referrer(ravi_c), "referred:", [p["name"] for p in ravi_c["referred"]])
    for cid in (meera, deepa["id"]):
        print("  ", show_referrer(l2.customer(cid)))
    l2.sql("SELECT * FROM standalone_referrer")
    l2.call("get", "/referrers/1")
    l2.sql(f"SELECT entity, entity_id, action, field, old_value, new_value FROM audit_entry"
           f" WHERE entity='customer' AND entity_id IN ({meera},{deepa['id']},{ravi_c['id']}) AND at LIKE '2026-10-19%'")
    l2b = Copy(built, "l2b")  # the variations, kept off the reader's sequence
    print("   Neha, typed with a 'new' Referrer on Meera's number:")
    _, neha = l2b.call("post", "/customers", json=new(
        "Neha Gupta", "9833344455", referrer={"kind": "new", "name": "M. Sharma", "address": "", "phone": "9810012345"}))
    print("  ", show_referrer(neha))
    print("   Omar, typed with a 'new' Referrer nobody knows:")
    _, omar = l2b.call("post", "/customers", json=new(
        "Omar Sheikh", "9844455566", referrer={"kind": "new", "name": "Salim Ali", "address": "Bandra", "phone": "9855566677"}))
    print("  ", show_referrer(omar))
    l2b.sql("SELECT * FROM standalone_referrer")
    print("   Choosing a Referrer that doesn't exist:")
    l2.call("post", "/customers/preview", json=new("X Y", "9866677788", referrer={"kind": "referrer", "id": 1}))
    l2.call("post", "/customers/preview", json=new("X Y", "9866677788", referrer={"kind": "customer", "id": 99}))
    print("   Both columns at once? the body names one kind only:")
    l2.call("post", "/customers/preview", json=new("X Y", "9866677788", referrer={"kind": "someone", "id": 1}))

    # ------------------------------------------------------------ lesson 3
    print("\n== L3. Adding, editing and deleting a Customer")
    c = ro.customer(meera)
    print(f"   Meera: email {c['email']!r} aadhaar_last4 {c['aadhaar_last4']!r} pan {c['pan']!r}"
          f" aadhaar_photo_url? {bool(c['aadhaar_photo_url'])} pan_photo_url? {bool(c['pan_photo_url'])}")
    for fields in ({"aadhaar_last4": "1234 5678 4821"}, {"aadhaar_last4": "XXXX XXXX 4821"},
                   {"aadhaar_last4": "4821"}, {"aadhaar_last4": "12345"},
                   {"pan": "abcps 1234k"}, {"pan": "ABCP1234K"}, {"email": "meera@"},
                   {"email": "", "aadhaar_last4": "", "pan": ""}):
        print(f"   new Customer with {fields}:")
        ro.call("post", "/customers/preview", json=new("Test Person", "9877788899", **fields))
    l3 = Copy(built, "l3")
    _, t = l3.call("post", "/customers", json=new("Test Person", "9877788899", aadhaar_last4="1234 5678 9012",
                                                    email="  ", pan=""))
    print(f"   saved: aadhaar_last4 {t['aadhaar_last4']!r} email {t['email']!r} pan {t['pan']!r}")
    l3.sql(f"SELECT field, old_value, new_value FROM audit_entry WHERE entity='customer' AND entity_id={t['id']}")
    print("   Meera's address and Referrer edited (Referrer -> Arjun):")
    l3.call("put", f"/customers/{meera}", json=l3.body_of(
        meera, address="15 Lajpat Nagar, New Delhi", referrer={"kind": "customer", "id": arjun}))
    l3.sql(f"SELECT id, action, field, old_value, new_value, note FROM audit_entry"
           f" WHERE entity='customer' AND entity_id={meera} AND at LIKE '2026-10-19%'")
    print("   A save that changes nothing:")
    before = sqlite3.connect(l3.db).execute("SELECT count(*) FROM audit_entry").fetchone()[0]
    l3.call("put", f"/customers/{meera}", json=l3.body_of(meera))
    after = sqlite3.connect(l3.db).execute("SELECT count(*) FROM audit_entry").fetchone()[0]
    print(f"   audit_entry rows {before} -> {after}")
    print("   A PUT that leaves out email and the Referrer (Preview, then the History it would write, on a scratch save):")
    body = l3.body_of(meera)
    del body["email"], body["referrer"]
    l3.call("put", f"/customers/{meera}/preview", json=body)
    l3x = Copy(built, "l3x")
    body = l3x.body_of(meera)
    del body["email"], body["referrer"]
    l3x.call("put", f"/customers/{meera}", json=body)
    l3x.sql(f"SELECT action, field, old_value, new_value FROM audit_entry WHERE entity='customer' AND entity_id={meera} AND at LIKE '2026-10-19%'")
    print("   Previews answer 204 with no body:")
    r = l3.api.post("/api/customers/preview", json=new("Someone New", "9888899900"))
    print(f"   POST /customers/preview -> {r.status_code} body={r.content!r}")
    print("   Delete Previews:")
    l3.call("post", f"/customers/{meera}/delete-preview")
    l3.call("post", f"/customers/{t['id']}/delete-preview")
    l3.call("post", "/customers/99/delete-preview")
    print("   Delete a Customer who referred someone:")
    _, a = l3.call("post", "/customers", json=new("Asha Rao", "9899900011"))
    _, b = l3.call("post", "/customers", json=new("Bina Rao", "9899900022", referrer={"kind": "customer", "id": a["id"]}))
    l3.call("delete", f"/customers/{a['id']}")
    print("  ", show_referrer(l3.customer(b["id"])))
    l3.sql(f"SELECT entity_id, action, field, note FROM audit_entry WHERE entity='customer' AND entity_id={a['id']} AND action='deleted'")
    print("   Standalone Referrer routes:", sorted({
        f"{m} {route.path}" for route in l3.api.app.routes for m in getattr(route, "methods", [])
        if "referrer" in route.path}))

    # ------------------------------------------------------------ lesson 4
    print("\n== L4. Photos and ID Photos")
    l4 = Copy(built, "l4")
    l4.sql(f"SELECT id, photo, aadhaar_photo, pan_photo FROM customer WHERE id = {meera}")
    print("   photos folder:", l4.files())
    old = l4.customer(meera)["aadhaar_photo_url"].rsplit("/", 1)[1]
    print("   Replace Meera's Aadhaar photo with a 4000x3000 phone photo:")
    code, after = l4.call("put", f"/customers/{meera}/id-photos/aadhaar",
                          files={"photo": ("aadhaar.jpg", jpeg(4000, 3000), "image/jpeg")})
    newf = after["aadhaar_photo_url"].rsplit("/", 1)[1]
    print(f"   old {old} exists? {(l4.photos / old).exists()}   new {newf} exists? {(l4.photos / newf).exists()}")
    print("   new size:", Image.open(l4.photos / newf).size)
    print("   photos folder:", l4.files())
    l4.sql(f"SELECT action, field, note FROM audit_entry WHERE entity='customer' AND entity_id={meera} AND at LIKE '2026-10-19%'")
    print("   A portrait taken sideways (3000x4000 stored as 4000x3000 with EXIF orientation 6):")
    _, after = l4.call("put", f"/customers/{meera}/photo",
                       files={"photo": ("p.jpg", jpeg(4000, 3000, orientation=6), "image/jpeg")})
    print("   stored size:", Image.open(l4.photos / after["photo_url"].rsplit("/", 1)[1]).size)
    print("   Not an image:")
    n = len(l4.files())
    l4.call("put", f"/customers/{meera}/id-photos/pan", files={"photo": ("pan.pdf", b"%PDF-1.4 hello", "application/pdf")})
    print(f"   files {n} -> {len(l4.files())}")
    print("   An ID Photo for a Customer who isn't there:")
    l4.call("put", "/customers/99/id-photos/pan", files={"photo": ("pan.jpg", jpeg(100, 60), "image/jpeg")})
    print(f"   files {n} -> {len(l4.files())}   {[f for f in l4.files() if f.startswith('customer-99')]}")
    print("   A card that isn't one of the two:")
    l4.call("put", f"/customers/{meera}/id-photos/passport", files={"photo": ("p.jpg", jpeg(100, 60), "image/jpeg")})
    print("   Remove her PAN photo:")
    pan = l4.customer(meera)["pan_photo_url"].rsplit("/", 1)[1]
    l4.call("delete", f"/customers/{meera}/id-photos/pan")
    print(f"   {pan} exists? {(l4.photos / pan).exists()}")
    before = sqlite3.connect(l4.db).execute("SELECT count(*) FROM audit_entry").fetchone()[0]
    l4.call("delete", f"/customers/{meera}/id-photos/pan")
    after = sqlite3.connect(l4.db).execute("SELECT count(*) FROM audit_entry").fetchone()[0]
    print(f"   removing it again: audit_entry rows {before} -> {after}")
    l4.sql(f"SELECT action, field, note FROM audit_entry WHERE entity='customer' AND entity_id={meera} AND at LIKE '2026-10-19%'")
    print("   read_photo guards:")
    ok = l4.customer(meera)["aadhaar_photo_url"]
    r = l4.api.get(ok)
    print(f"   GET {ok} -> {r.status_code} {r.headers.get('content-type')}")
    for bad in ("mortgage.db", "..%2Fmortgage.db", "customer-1-abc.jpg", "notes.txt"):
        r = l4.api.get(f"/api/photos/{bad}")
        print(f"   GET /api/photos/{bad} -> {r.status_code}")
    _, page = l4.call("get", "/customers", quiet=True)
    print("   Customers list row keys:", sorted(page["items"][0]))
    print("   Customer page keys:", sorted(l4.customer(meera)))
    print("   Deleting a Customer with photos takes the files:")
    _, x = l4.call("post", "/customers", json=new("Photo Person", "9811100000"))
    l4.call("put", f"/customers/{x['id']}/photo", files={"photo": ("p.jpg", jpeg(200, 200), "image/jpeg")})
    l4.call("put", f"/customers/{x['id']}/id-photos/aadhaar", files={"photo": ("a.jpg", jpeg(200, 120), "image/jpeg")})
    mine = [f for f in l4.files() if f.startswith(f"customer-{x['id']}-")]
    print("   their files:", mine)
    l4.call("delete", f"/customers/{x['id']}")
    print("   after delete:", [f for f in l4.files() if f.startswith(f"customer-{x['id']}-")])
    print("   Mortgage photos: the ring's", l4.call("get", f"/mortgages/{RING}", quiet=True)[1]["photos"])

    # ------------------------------------------------------------ lesson 5
    print("\n== L5. Gold Rates, Collateral Value and Loan-to-Value")
    _, rates = ro.call("get", "/settings/gold-rates")
    for r in rates:
        print(f"   {r['purity_karat']}K {rs(r['rate_per_gram'])}/g  updated_on {r['updated_on']}")
    ro.sql("SELECT key, value FROM config WHERE key LIKE 'gold_rate%' ORDER BY key")
    print("   Every Mortgage on 19 Oct:")
    for mid in range(1, 11):
        _, m = ro.call("get", f"/mortgages/{mid}", quiet=True)
        col = m["collateral"]
        print(f"   {mid:2} {m['name']:30} {m['status']:9} net {m['net_weight_mg']} mg {m['purity_karat']}K"
              f" outstanding {rs(m['outstanding']['total']):>10}"
              + (f" value {rs(col['value']):>10} {col['source']} set_on {col['set_on']} LTV {col['loan_to_value']:.4f}" if col else " no collateral"))
    print("   Rounding half-up to the paisa (collateral_of called directly):")
    for mg, per_g in ((6000, 1353600), (6001, 1353650), (6001, 1353500), (6003, 1353650)):
        rate = GoldRate(purity_karat=22, rate_per_gram=per_g, updated_on=THE_DAY)
        row = {"collateral_override": None, "purity_karat": 22, "net_weight_mg": mg}
        v = collateral_of(row, {22: rate}, 100).value
        print(f"   {mg} mg x {rs(per_g)}/g = {mg * per_g / 1000:,.3f} paise exact -> {v} paise = ₹{rs(v)}")
    print("   Without a Gold Rate for its purity:")
    row = {"collateral_override": None, "purity_karat": 22, "net_weight_mg": 6000}
    print("   ", collateral_of(row, {22: GoldRate(purity_karat=22, rate_per_gram=None, updated_on=None)}, 100))
    fresh_folder = built.parent / "fresh"
    (fresh_folder / "data").mkdir(parents=True)
    clock = {"day": date(2026, 10, 1)}
    fresh = TestClient(create_app(f"sqlite:///{fresh_folder / 'data' / 'mortgage.db'}", today=lambda: clock["day"]))
    with fresh:
        print("   fresh database gold rates:", fresh.get("/api/settings/gold-rates").json())
        everything = [{"purity_karat": k, "rate_per_gram": r * RUPEE}
                      for k, r in ((24, 14_200), (22, 13_000), (20, 11_850), (18, 10_650), (14, 8_280))]
        fresh.put("/api/settings/gold-rates", json=everything)
        clock["day"] = THE_DAY
        everything[1] = {"purity_karat": 22, "rate_per_gram": 13_536 * RUPEE}
        print("   1 Oct: all five set; 19 Oct: the same five sent again, only 22K changed:")
        for r in fresh.put("/api/settings/gold-rates", json=everything).json():
            print(f"     {r['purity_karat']}K {rs(r['rate_per_gram'])} updated_on {r['updated_on']}")
        print("   PUT a 0 rate:", fresh.put("/api/settings/gold-rates", json=[{"purity_karat": 22, "rate_per_gram": 0}]).status_code)
        print("   PUT a 23K rate:", fresh.put("/api/settings/gold-rates", json=[{"purity_karat": 23, "rate_per_gram": 100}]).status_code)
    print("   Dashboard:")
    _, d = ro.call("get", "/dashboard", quiet=True)
    print(f"   collateral_value {rs(d['collateral_value'])} loan_to_value {d['loan_to_value']}"
          f" principal {rs(d['principal_outstanding'])} unpaid {rs(d['unpaid_interest'])}")
    print("   The ring's Projection:")
    _, p = ro.call("get", f"/mortgages/{RING}/projection", quiet=True)
    print("   ", {k: v for k, v in p.items() if k != "points"})
    for pt in p.get("points", [])[:4]:
        print("     ", pt)
    print("   Call List reasons on 19 Oct:")
    _, cl = ro.call("get", "/call-list", quiet=True)
    for group in cl["items"]:
        for row in group["rows"]:
            print("     ", group.get("customer", group.get("name")), {k: v for k, v in row.items() if k in ("mortgage_id", "mortgage_name", "reasons", "loan_to_value")})
    l5r = Copy(built, "l5-reader")  # the reader's sequence: set by hand, then clear
    print("   Reader: set ₹90,000, then clear, Gold Rates unchanged:")
    print("   ", l5r.call("put", f"/mortgages/{RING}/collateral", json={"value": 90_000 * RUPEE})[1]["collateral"])
    print("   ", l5r.call("put", f"/mortgages/{RING}/collateral", json={"value": None})[1]["collateral"])
    _, cl = l5r.call("get", "/call-list", quiet=True)
    print("    ring still listed:", [r["reasons"] for g in cl["items"] for r in g["rows"] if r["mortgage_id"] == RING])
    l5 = Copy(built, "l5")
    print("   Set the ring's value by hand to ₹90,000 (Preview, then save):")
    _, pv = l5.call("post", f"/mortgages/{RING}/collateral-preview", json={"value": 90_000 * RUPEE})
    print("   ", pv)
    _, m = l5.call("put", f"/mortgages/{RING}/collateral", json={"value": 90_000 * RUPEE})
    print("   ", m["collateral"])
    l5.sql(f"SELECT collateral_override, collateral_override_on FROM mortgage WHERE id={RING}")
    print("   The Gold Rate moves: 22K to ₹14,000 (the hand value stays):")
    l5.call("put", "/settings/gold-rates", json=[{"purity_karat": 22, "rate_per_gram": 14_000 * RUPEE},
                                                {"purity_karat": 24, "rate_per_gram": 14_766 * RUPEE}])
    _, rates = l5.call("get", "/settings/gold-rates", quiet=True)
    print("   ", [(r["purity_karat"], rs(r["rate_per_gram"]), r["updated_on"]) for r in rates])
    print("   ", l5.call("get", f"/mortgages/{RING}", quiet=True)[1]["collateral"])
    print("   Cleared:")
    _, m = l5.call("put", f"/mortgages/{RING}/collateral", json={"value": None})
    print("   ", m["collateral"])
    l5.sql(f"SELECT collateral_override, collateral_override_on FROM mortgage WHERE id={RING}")
    l5.sql(f"SELECT action, field, old_value, new_value FROM audit_entry WHERE entity='mortgage' AND entity_id={RING} AND at LIKE '2026-10-19%'")
    print("   Refusals:")
    l5.call("put", f"/mortgages/{COIN}/collateral", json={"value": 50_000 * RUPEE})
    l5.call("put", f"/mortgages/{RING}/collateral", json={"value": 0})
    l5.call("put", "/mortgages/99/collateral", json={"value": 100})

    # ------------------------------------------------------------ 99
    print("\n== 99. Check yourself")
    _, m = ro.call("get", "/mortgages/8", quiet=True)
    print(f"   Arjun's chain: net {m['net_weight_mg']} mg {m['purity_karat']}K outstanding {rs(m['outstanding']['total'])}"
          f" collateral {m['collateral']}")
    _, m = ro.call("get", "/mortgages/9", quiet=True)
    print(f"   Mangalsutra: net {m['net_weight_mg']} mg {m['purity_karat']}K outstanding {rs(m['outstanding']['total'])}"
          f" collateral {m['collateral']}")
    print("   A 'new' Referrer on Sunita's contact number 2 (Meera's family phone):")
    q = Copy(built, "q")
    _, z = q.call("post", "/customers", json=new(
        "Zara Khan", "9800011122", referrer={"kind": "new", "name": "Family phone", "address": "", "phone": "9810099999"}))
    print("  ", show_referrer(z))


if __name__ == "__main__":
    main()
