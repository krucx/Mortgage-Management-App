"""Lists sorted by a column, either way, across every page (today is 20 Apr 2026, see
conftest). Pages hold 20, so 25 rows make two pages.
"""

from datetime import date

from seed import LAKH, add_customer, add_mortgage, add_payment

from mortgage_backend.db import make_engine

RUPEE = 100  # paise


def person(client, n, address="", referrer=None, name=None):
    response = client.post(
        "/api/customers",
        json={
            "name": name or f"Customer {n:02d}",
            "address": address,
            "phone_1": f"98290{n:05d}",
            "referrer": referrer,
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


def get(client, path, **params):
    response = client.get(f"/api/{path}", params=params)
    assert response.status_code == 200, response.text
    return response.json()


def every_page(client, path, **params):
    """The listed items of every page, in order."""
    first = get(client, path, **params)
    items = first["items"]
    for page in range(2, -(-first["total"] // first["page_size"]) + 1):
        items += get(client, path, page=page, **params)["items"]
    return items


def test_customers_sort_by_name_either_way_across_pages(client):
    for n in range(1, 26):
        person(client, n)

    names = [
        c["name"] for c in every_page(client, "customers", sort="name", descending=True)
    ]

    assert names == [f"Customer {n:02d}" for n in range(25, 0, -1)]


def test_customers_sort_by_address_and_phone(client):
    person(client, 3, address="Bapu Bazaar", name="Asha")
    person(client, 1, address="Chandpole", name="Bina")
    person(client, 2, address="amer Road", name="Chetan")

    def names(**sort):
        return [c["name"] for c in get(client, "customers", **sort)["items"]]

    assert names(sort="address") == ["Chetan", "Asha", "Bina"]  # ignoring case
    assert names(sort="phone", descending=True) == ["Asha", "Chetan", "Bina"]


def test_customers_sort_by_referrer_customers_and_standalone_alike(client):
    zoya = person(client, 1, name="Zoya")
    person(client, 2, name="By Zoya", referrer={"kind": "customer", "id": zoya["id"]})
    person(
        client,
        3,
        name="By Mohan",
        referrer={
            "kind": "new",
            "name": "Mohan Lal",
            "address": "",
            "phone": "9000000009",
        },
    )

    listed = [c["name"] for c in get(client, "customers", sort="referrer")["items"]]

    assert listed == ["Zoya", "By Mohan", "By Zoya"]  # no Referrer first


SIMPLE_3 = {
    "monthly_rate_bps": 300,
    "interest_mode": "simple",
    "part_month_rule": "full_month",
}


def lend(client, owner, rupees, start="2026-01-14"):
    response = client.post(
        "/api/mortgages",
        json={
            "customer_id": owner["id"],
            "start_date": start,
            "amount_lent": rupees * RUPEE,
            "description": "Gold ring",
            "gross_weight_mg": 5_000,
            "net_weight_mg": 5_000,
            "purity_karat": 22,
            "terms": SIMPLE_3,
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


def test_mortgages_sort_by_outstanding_across_pages(client):
    owner = person(client, 1)
    # Outstanding is computed, not stored: the older ones have more interest added.
    lent = [
        lend(client, owner, 10_000, start=f"2026-01-{day:02d}") for day in range(1, 26)
    ]

    listed = every_page(client, "mortgages", sort="outstanding", descending=True)

    owed = [m["outstanding_total"] for m in listed]
    assert owed == sorted(owed, reverse=True) and owed[0] > owed[-1]
    assert len({m["id"] for m in listed}) == len(lent)


def test_mortgages_sort_by_principal_lent_across_pages(client):
    owner = person(client, 1)
    for rupees in range(25, 0, -1):
        lend(client, owner, rupees * 1_000)

    listed = every_page(client, "mortgages", sort="lent")

    assert [m["amount_lent"] for m in listed] == [
        r * 1_000 * RUPEE for r in range(1, 26)
    ]


def test_mortgages_sort_by_name_and_customer(client):
    asha = person(client, 1, name="Asha")
    bina = person(client, 2, name="Bina")
    first = lend(client, bina, 1_000)
    second = lend(client, asha, 1_000)

    def ids(**sort):
        return [m["id"] for m in get(client, "mortgages", **sort)["items"]]

    assert ids(sort="customer") == [second["id"], first["id"]]
    assert ids(sort="customer", descending=True) == [first["id"], second["id"]]
    by_name = sorted([first, second], key=lambda m: m["name"].lower())
    assert ids(sort="name") == [m["id"] for m in by_name]


def test_mortgages_keep_newest_first_by_default(client):
    owner = person(client, 1)
    older = lend(client, owner, 1_000, start="2026-01-01")
    newer = lend(client, owner, 1_000, start="2026-02-01")

    assert [m["id"] for m in get(client, "mortgages")["items"]] == [
        newer["id"],
        older["id"],
    ]


def pay(client, mortgage, rupees, on="2026-04-01", method="cash"):
    response = client.post(
        "/api/payments",
        json={
            "customer_id": mortgage["customer"]["id"],
            "paid_on": on,
            "amount": rupees * RUPEE,
            "method": method,
            "allocations": [{"mortgage_id": mortgage["id"], "amount": rupees * RUPEE}],
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


def test_payments_sort_by_amount_across_pages(client):
    mortgage = lend(client, person(client, 1), 100_000)
    for n in range(25):
        pay(client, mortgage, (n * 7 % 25 + 1) * 10)  # 10, 80, 150, … shuffled

    listed = every_page(client, "payments", sort="amount")

    assert [p["amount"] for p in listed] == [r * 10 * RUPEE for r in range(1, 26)]


def test_payments_sort_by_customer_mortgage_method_and_date(client):
    bina_ring = lend(client, person(client, 1, name="Bina"), 10_000)
    asha_ring = lend(client, person(client, 2, name="Asha"), 10_000)
    first = pay(client, bina_ring, 100, on="2026-03-01", method="upi")
    second = pay(client, asha_ring, 100, on="2026-04-01", method="cash")

    def ids(**sort):
        return [p["id"] for p in get(client, "payments", **sort)["items"]]

    assert ids() == [second["id"], first["id"]]  # newest first by default
    assert ids(sort="date") == [first["id"], second["id"]]
    assert ids(sort="customer") == [second["id"], first["id"]]
    assert ids(sort="method", descending=True) == [first["id"], second["id"]]
    by_mortgage = sorted(
        [(bina_ring, first), (asha_ring, second)], key=lambda pair: pair[0]["name"]
    )
    assert ids(sort="mortgages") == [p["id"] for _, p in by_mortgage]


def test_mortgages_sort_by_started_and_by_status_in_their_lifecycle_order(client):
    owner = person(client, 1)
    redeemed = lend(client, owner, 1_000, start="2026-01-01")
    forfeited = lend(client, owner, 1_000, start="2026-03-01")
    active = lend(client, owner, 1_000, start="2026-02-01")
    assert client.post(
        f"/api/mortgages/{redeemed['id']}/redeem",
        json={"redeemed_on": "2026-04-20", "method": "cash"},
    ).is_success
    assert client.post(
        f"/api/mortgages/{forfeited['id']}/forfeit",
        json={"forfeited_on": "2026-04-20", "recovered_amount": 0, "note": ""},
    ).is_success

    def ids(**sort):
        return [m["id"] for m in get(client, "mortgages", **sort)["items"]]

    assert ids(sort="started") == [redeemed["id"], active["id"], forfeited["id"]]
    assert ids(sort="status") == [active["id"], redeemed["id"], forfeited["id"]]


def test_mortgages_owing_something_sort_too(client):
    owner = person(client, 1)
    small = lend(client, owner, 1_000, start="2026-01-01")
    large = lend(client, owner, 9_000, start="2026-02-01")
    paid_off = lend(client, owner, 5_000, start="2026-03-01")
    owed = get(client, f"mortgages/{paid_off['id']}")["outstanding"]["total"]
    pay(client, paid_off, owed // RUPEE, on="2026-04-01")

    listed = get(client, "mortgages", owing=True, sort="lent")["items"]

    assert [m["id"] for m in listed] == [small["id"], large["id"]]


def book(database_url, start, paid=False):
    """25 Customers, "Customer 01" to "25", each with a Mortgage from `start`, lent
    ₹1,000 more for each (and paid off on 10 Apr if `paid`)."""
    with make_engine(database_url).begin() as conn:
        for n in range(1, 26):
            owner = add_customer(conn, phone=f"98290{n:05d}", name=f"Customer {n:02d}")
            lent = LAKH + n * 1_000 * RUPEE
            mortgage = add_mortgage(
                conn, owner, suffix=f"{n:02d}", start_date=start, amount_lent=lent
            )
            if paid:
                add_payment(conn, owner, date(2026, 4, 10), {mortgage: lent})


def test_notices_sort_by_customer_across_pages(client, database_url):
    book(database_url, date(2026, 1, 21))  # all accrue tomorrow

    notices = every_page(client, "notices", sort="customer", descending=True)

    assert [n["customer"]["name"] for n in notices] == [
        f"Customer {n:02d}" for n in range(25, 0, -1)
    ]


def test_notices_keep_their_own_order_unsorted(client, database_url):
    book(database_url, date(2026, 1, 21))

    notices = every_page(client, "notices")

    assert [n["customer"]["name"] for n in notices] == [
        f"Customer {n:02d}" for n in range(1, 26)
    ]


def test_the_call_list_sorts_by_outstanding_across_pages(client, database_url):
    book(database_url, date(2026, 1, 14))  # 3 Months Unpaid each

    groups = every_page(client, "call-list", sort="outstanding", descending=True)

    assert [g["customer"]["name"] for g in groups] == [
        f"Customer {n:02d}" for n in range(25, 0, -1)
    ]


def test_the_call_list_sorts_by_customer_across_pages(client, database_url):
    book(database_url, date(2026, 1, 14))

    groups = every_page(client, "call-list", sort="customer")

    assert [g["customer"]["name"] for g in groups] == [
        f"Customer {n:02d}" for n in range(1, 26)
    ]


def test_ready_to_redeem_sorts_by_customer_across_pages(client, database_url):
    book(database_url, date(2026, 4, 1), paid=True)

    ready = every_page(
        client, "closures/ready-to-redeem", sort="customer", descending=True
    )

    assert [r["mortgage"]["customer"]["name"] for r in ready] == [
        f"Customer {n:02d}" for n in range(25, 0, -1)
    ]


def test_mortgages_by_outstanding_or_owing_come_twenty_a_page(client, database_url):
    book(database_url, date(2026, 1, 14))

    first = get(client, "mortgages", sort="outstanding", descending=True)
    owing = get(client, "mortgages", owing="true", page=2)
    by_outstanding = every_page(
        client, "mortgages", sort="outstanding", descending=True
    )

    assert (first["page_size"], len(first["items"]), first["total"]) == (20, 20, 25)
    assert (owing["page_size"], len(owing["items"])) == (20, 5)
    owed = [m["outstanding_total"] for m in by_outstanding]
    assert owed == sorted(owed, reverse=True) and len(set(owed)) == 25
