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
