import pytest

LAKH = 100_000_00  # ₹1,00,000 in paise


@pytest.fixture
def ramesh(client):
    return client.post(
        "/api/customers",
        json={"name": "Ramesh Kumar", "address": "", "phone_1": "9829012345"},
    ).json()


@pytest.fixture
def mortgage(client, ramesh):
    # ₹1,00,000 at 3% Simple from 14 Jan; today (conftest) is 20 Apr 2026.
    return client.post(
        "/api/mortgages",
        json={
            "customer_id": ramesh["id"],
            "start_date": "2026-01-14",
            "amount_lent": LAKH,
            "description": "Gold chain",
            "gross_weight_mg": 20_000,
            "net_weight_mg": 19_000,
            "purity_karat": 22,
            "terms": {
                "monthly_rate_bps": 300,
                "interest_mode": "simple",
                "part_month_rule": "full_month",
            },
        },
    ).json()


def payment_fields(ramesh, mortgage, amount, paid_on="2026-04-20", **overrides):
    return {
        "customer_id": ramesh["id"],
        "paid_on": paid_on,
        "amount": amount,
        "method": "cash",
        "allocations": [{"mortgage_id": mortgage["id"], "amount": amount}],
        **overrides,
    }


def pay(client, ramesh, mortgage, amount, **overrides):
    response = client.post(
        "/api/payments", json=payment_fields(ramesh, mortgage, amount, **overrides)
    )
    assert response.status_code == 201, response.text
    return response.json()


def test_a_payment_pays_interest_first_then_principal(client, ramesh, mortgage):
    # Owed on 20 Apr: 3 months' interest (₹9,000) + ₹1,00,000.
    payment = pay(client, ramesh, mortgage, 19_000_00, method="upi", reference="UTR123")

    assert payment["customer"]["name"] == "Ramesh Kumar"
    assert payment["paid_on"] == "2026-04-20"
    assert payment["amount"] == 19_000_00
    assert payment["method"] == "upi"
    assert payment["reference"] == "UTR123"
    assert payment["allocations"] == [
        {
            "mortgage_id": mortgage["id"],
            "mortgage_name": mortgage["name"],
            "amount": 19_000_00,
            "interest_paid": 9_000_00,
            "principal_paid": 10_000_00,
        }
    ]
    assert client.get(f"/api/payments/{payment['id']}").json() == payment


def test_the_mortgage_ledger_shows_the_payment_and_what_is_left(
    client, ramesh, mortgage
):
    payment = pay(client, ramesh, mortgage, 19_000_00)

    page = client.get(f"/api/mortgages/{mortgage['id']}").json()

    step = page["ledger"][-1]
    assert (step["on"], step["event"], step["amount"]) == (
        "2026-04-20",
        "payment",
        19_000_00,
    )
    assert (step["interest_paid"], step["principal_paid"]) == (9_000_00, 10_000_00)
    assert step["payment_id"] == payment["id"]
    assert page["outstanding"] == {
        "principal": 90_000_00,
        "unpaid_interest": 0,
        "total": 90_000_00,
    }


def test_a_back_dated_payment_is_slotted_into_the_ledger_by_date(
    client, ramesh, mortgage
):
    pay(client, ramesh, mortgage, 1_000_00, paid_on="2026-04-01")
    pay(client, ramesh, mortgage, 2_000_00, paid_on="2026-02-20")

    page = client.get(f"/api/mortgages/{mortgage['id']}").json()

    assert [(s["on"], s["event"]) for s in page["ledger"]] == [
        ("2026-01-14", "started"),
        ("2026-02-14", "interest"),
        ("2026-02-20", "payment"),
        ("2026-03-14", "interest"),
        ("2026-04-01", "payment"),
        ("2026-04-14", "interest"),
    ]
    assert page["outstanding"]["unpaid_interest"] == 6_000_00


def test_a_payment_larger_than_what_is_owed_is_refused(client, ramesh, mortgage):
    response = client.post(
        "/api/payments", json=payment_fields(ramesh, mortgage, 109_000_01)
    )

    assert response.status_code == 422
    assert "₹1,09,000" in response.json()["detail"]
    assert (
        client.get(f"/api/mortgages/{mortgage['id']}").json()["ledger"][-1]["event"]
        == "interest"
    )


def test_a_back_dated_payment_that_would_overpay_a_later_one_is_refused(
    client, ramesh, mortgage
):
    pay(client, ramesh, mortgage, 109_000_00)  # pays everything off on 20 Apr

    response = client.post(
        "/api/payments",
        json=payment_fields(ramesh, mortgage, 5_000_00, paid_on="2026-03-01"),
    )

    assert response.status_code == 422
    page = client.get(f"/api/mortgages/{mortgage['id']}").json()
    assert page["outstanding"]["total"] == 0


@pytest.mark.parametrize(
    "bad",
    [
        {"paid_on": "2026-04-21"},  # after today
        {"paid_on": "2026-01-13"},  # before the Mortgage started
        {"amount": 0},
        {"method": "cheque"},
        {"allocations": []},
        {"customer_id": 999},
    ],
)
def test_invalid_payments_are_rejected(client, ramesh, mortgage, bad):
    fields = {**payment_fields(ramesh, mortgage, 1_000_00), **bad}
    if bad.get("amount") == 0:
        fields["allocations"][0]["amount"] = 0

    assert client.post("/api/payments", json=fields).status_code == 422


def test_allocations_must_add_up_to_the_payment(client, ramesh, mortgage):
    fields = payment_fields(ramesh, mortgage, 1_000_00)
    fields["allocations"][0]["amount"] = 900_00

    assert client.post("/api/payments", json=fields).status_code == 422


def test_a_payment_cannot_go_to_another_customers_mortgage(client, ramesh, mortgage):
    sita = client.post(
        "/api/customers", json={"name": "Sita", "address": "", "phone_1": "9000000005"}
    ).json()

    response = client.post(
        "/api/payments",
        json={**payment_fields(ramesh, mortgage, 1_000_00), "customer_id": sita["id"]},
    )

    assert response.status_code == 422


def test_a_payment_to_a_mortgage_that_does_not_exist_is_rejected(
    client, ramesh, mortgage
):
    fields = payment_fields(ramesh, mortgage, 1_000_00)
    fields["allocations"][0]["mortgage_id"] = 999

    assert client.post("/api/payments", json=fields).status_code == 422


def test_opening_a_payment_that_does_not_exist_is_404(client):
    assert client.get("/api/payments/999").status_code == 404


# --- Lump sums across several Mortgages, the Payments list, Outstanding on a date.


@pytest.fixture
def second_mortgage(client, ramesh):
    # ₹50,000 at 3% Simple from 1 Feb: owes ₹1,500/month.
    return client.post(
        "/api/mortgages",
        json={
            "customer_id": ramesh["id"],
            "start_date": "2026-02-01",
            "amount_lent": 50_000_00,
            "description": "Bangles",
            "gross_weight_mg": 10_000,
            "net_weight_mg": 9_000,
            "purity_karat": 22,
            "terms": {
                "monthly_rate_bps": 300,
                "interest_mode": "simple",
                "part_month_rule": "full_month",
            },
        },
    ).json()


def lump_sum(ramesh, allocations, paid_on="2026-04-20", **overrides):
    return {
        "customer_id": ramesh["id"],
        "paid_on": paid_on,
        "amount": sum(amount for _, amount in allocations),
        "method": "cash",
        "allocations": [
            {"mortgage_id": m["id"], "amount": amount} for m, amount in allocations
        ],
        **overrides,
    }


def test_one_payment_can_be_allocated_across_several_mortgages(
    client, ramesh, mortgage, second_mortgage
):
    response = client.post(
        "/api/payments",
        json=lump_sum(ramesh, [(mortgage, 12_000_00), (second_mortgage, 8_000_00)]),
    )

    assert response.status_code == 201
    payment = response.json()
    assert [
        (a["mortgage_name"], a["interest_paid"], a["principal_paid"])
        for a in payment["allocations"]
    ] == [
        (mortgage["name"], 9_000_00, 3_000_00),
        (second_mortgage["name"], 3_000_00, 5_000_00),  # 2 months' interest by 20 Apr
    ]
    for m, principal in [(mortgage, 97_000_00), (second_mortgage, 45_000_00)]:
        page = client.get(f"/api/mortgages/{m['id']}").json()
        assert page["ledger"][-1]["payment_id"] == payment["id"]
        assert page["outstanding"]["principal"] == principal


def test_a_lump_sum_larger_than_everything_owed_is_refused(
    client, ramesh, mortgage, second_mortgage
):
    # Owed on 20 Apr: ₹1,09,000 and ₹53,000.
    response = client.post(
        "/api/payments",
        json=lump_sum(ramesh, [(mortgage, 109_000_00), (second_mortgage, 53_000_01)]),
    )

    assert response.status_code == 422
    assert (
        client.get(f"/api/mortgages/{mortgage['id']}").json()["outstanding"]["total"]
        == 109_000_00
    )


def test_outstanding_can_be_read_as_of_an_earlier_date(
    client, ramesh, mortgage, second_mortgage
):
    rows = client.get(
        "/api/mortgages",
        params={"customer_id": ramesh["id"], "status": "active", "as_of": "2026-03-01"},
    ).json()["items"]

    assert {row["name"]: row["outstanding_total"] for row in rows} == {
        mortgage["name"]: 103_000_00,  # one month's interest by 1 Mar
        second_mortgage[
            "name"
        ]: 51_500_00,  # started 1 Feb; first interest on 1 Mar itself
    }


def test_outstanding_cannot_be_read_for_a_future_date(client, ramesh, mortgage):
    assert (
        client.get("/api/mortgages", params={"as_of": "2026-04-21"}).status_code == 422
    )


def list_payments(client, **params):
    response = client.get("/api/payments", params=params)
    assert response.status_code == 200
    return response.json()


def test_payments_are_listed_newest_first_with_their_mortgages(
    client, ramesh, mortgage, second_mortgage
):
    pay(client, ramesh, mortgage, 1_000_00, paid_on="2026-03-01")
    client.post(
        "/api/payments",
        json=lump_sum(
            ramesh,
            [(mortgage, 2_000_00), (second_mortgage, 1_000_00)],
            reference="UTR9",
        ),
    )

    page = list_payments(client)

    assert page["total"] == 2
    newest = page["items"][0]
    assert newest["paid_on"] == "2026-04-20"
    assert newest["customer"]["name"] == "Ramesh Kumar"
    assert newest["amount"] == 3_000_00
    assert newest["reference"] == "UTR9"
    assert newest["mortgage_names"] == [mortgage["name"], second_mortgage["name"]]
    assert page["items"][1]["paid_on"] == "2026-03-01"


def test_payments_can_be_filtered_by_customer_mortgage_or_reference(
    client, ramesh, mortgage, second_mortgage
):
    sita = client.post(
        "/api/customers", json={"name": "Sita", "address": "", "phone_1": "9000000005"}
    ).json()
    pay(client, ramesh, mortgage, 1_000_00, reference="UTR9")
    pay(client, ramesh, second_mortgage, 1_000_00)

    def count(q):
        return list_payments(client, q=q)["total"]

    assert count("ramesh") == 2
    assert count("sita") == 0
    assert count("bangles") == 1  # Mortgage Name
    assert count("utr9") == 1
    assert sita  # exists but has no Payments
