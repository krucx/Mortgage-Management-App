import pytest
from api_seed import lend, pay, person


@pytest.fixture
def ramesh(client):
    return person(client)


@pytest.fixture
def mortgage(client, ramesh):
    # ₹1,00,000 at 3% Simple from 14 Jan; today (conftest) is 20 Apr 2026.
    return lend(client, ramesh)


def payment_fields(ramesh, mortgage, amount, paid_on="2026-04-20", **overrides):
    return {
        "customer_id": ramesh["id"],
        "paid_on": paid_on,
        "amount": amount,
        "method": "cash",
        "allocations": [{"mortgage_id": mortgage["id"], "amount": amount}],
        **overrides,
    }


def test_a_payment_pays_interest_first_then_principal(client, ramesh, mortgage):
    # Owed on 20 Apr: 3 months' interest (₹9,000), the month starting 14 Apr's ₹3,000
    # Interest to Date, and ₹1,00,000.
    payment = pay(
        client,
        ramesh,
        {mortgage["id"]: 19_000_00},
        on="2026-04-20",
        method="upi",
        reference="UTR123",
    )

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
            "interest_paid": 12_000_00,
            "principal_paid": 7_000_00,
        }
    ]
    assert client.get(f"/api/payments/{payment['id']}").json() == payment


def test_the_mortgage_ledger_shows_the_payment_and_what_is_left(
    client, ramesh, mortgage
):
    payment = pay(client, ramesh, {mortgage["id"]: 19_000_00}, on="2026-04-20")

    page = client.get(f"/api/mortgages/{mortgage['id']}").json()

    step = page["ledger"][-2]  # then the Interest to Date
    assert (step["on"], step["event"], step["amount"]) == (
        "2026-04-20",
        "payment",
        19_000_00,
    )
    assert (step["interest_paid"], step["principal_paid"]) == (12_000_00, 7_000_00)
    assert step["payment_id"] == payment["id"]
    # The month starting 14 Apr, charged on ₹1,00,000 (ADR 0006), is paid ahead.
    to_date = page["ledger"][-1]
    assert (to_date["amount"], to_date["paid_ahead"]) == (3_000_00, 3_000_00)
    assert page["outstanding"] == {
        "principal": 93_000_00,
        "unpaid_interest": 0,
        "total": 93_000_00,
    }


def test_a_back_dated_payment_is_slotted_into_the_ledger_by_date(
    client, ramesh, mortgage
):
    pay(client, ramesh, {mortgage["id"]: 1_000_00}, on="2026-04-01")
    pay(client, ramesh, {mortgage["id"]: 2_000_00}, on="2026-02-20")

    page = client.get(f"/api/mortgages/{mortgage['id']}").json()

    assert [(s["on"], s["event"]) for s in page["ledger"]] == [
        ("2026-01-14", "started"),
        ("2026-02-14", "interest"),
        ("2026-02-20", "payment"),
        ("2026-03-14", "interest"),
        ("2026-04-01", "payment"),
        ("2026-04-14", "interest"),
        ("2026-04-20", "interest_to_date"),
    ]
    assert page["outstanding"]["unpaid_interest"] == 9_000_00


def test_a_payment_larger_than_what_is_owed_is_refused(client, ramesh, mortgage):
    response = client.post(
        "/api/payments", json=payment_fields(ramesh, mortgage, 112_000_01)
    )

    assert response.status_code == 422
    assert "₹1,12,000 owed" in response.json()["detail"]  # its Outstanding
    assert (
        client.get(f"/api/mortgages/{mortgage['id']}").json()["ledger"][-2]["event"]
        == "interest"
    )


def test_a_back_dated_payment_that_would_overpay_a_later_one_is_refused(
    client, ramesh, mortgage
):
    # Pays all but the Interest to Date on 20 Apr.
    pay(client, ramesh, {mortgage["id"]: 109_000_00}, on="2026-04-20")

    response = client.post(
        "/api/payments",
        json=payment_fields(ramesh, mortgage, 5_000_00, paid_on="2026-03-01"),
    )

    assert response.status_code == 422
    page = client.get(f"/api/mortgages/{mortgage['id']}").json()
    assert page["outstanding"]["total"] == 3_000_00


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
    sita = person(client, "Sita", "9000000005")

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
    return lend(
        client,
        ramesh,
        "2026-02-01",
        amount=50_000_00,
        description="Bangles",
        net_weight_mg=9_000,
    )


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
        # 3 months' interest and ₹3,000 Interest to Date: no Principal yet
        (mortgage["name"], 12_000_00, 0),
        # 2 months' interest by 20 Apr and ₹1,500 Interest to Date
        (second_mortgage["name"], 4_500_00, 3_500_00),
    ]
    for m, principal in [(mortgage, 100_000_00), (second_mortgage, 46_500_00)]:
        page = client.get(f"/api/mortgages/{m['id']}").json()
        assert page["ledger"][-2]["payment_id"] == payment["id"]
        assert page["outstanding"]["principal"] == principal


def test_a_lump_sum_larger_than_everything_owed_is_refused(
    client, ramesh, mortgage, second_mortgage
):
    # Owed on 20 Apr: ₹1,12,000 and ₹54,500, their Interest to Date included.
    response = client.post(
        "/api/payments",
        json=lump_sum(ramesh, [(mortgage, 109_000_00), (second_mortgage, 54_500_01)]),
    )

    assert response.status_code == 422
    assert (
        client.get(f"/api/mortgages/{mortgage['id']}").json()["outstanding"]["total"]
        == 112_000_00
    )


def test_outstanding_can_be_read_as_of_an_earlier_date(
    client, ramesh, mortgage, second_mortgage
):
    rows = client.get(
        "/api/mortgages",
        params={"customer_id": ramesh["id"], "status": "active", "as_of": "2026-03-01"},
    ).json()["items"]

    assert {row["name"]: row["outstanding_total"] for row in rows} == {
        # one month's interest by 1 Mar, and the month starting 14 Feb
        mortgage["name"]: 106_000_00,
        # started 1 Feb; first interest on 1 Mar itself, and the month starting then
        second_mortgage["name"]: 53_000_00,
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
    pay(client, ramesh, {mortgage["id"]: 1_000_00}, on="2026-03-01")
    both = {mortgage["id"]: 2_000_00, second_mortgage["id"]: 1_000_00}
    pay(client, ramesh, both, on="2026-04-20", reference="UTR9")

    page = list_payments(client)

    assert page["total"] == 2
    newest = page["items"][0]
    assert newest["paid_on"] == "2026-04-20"
    assert newest["customer"]["name"] == "Ramesh Kumar"
    assert newest["amount"] == 3_000_00
    assert newest["reference"] == "UTR9"
    assert newest["mortgages"] == [
        {"id": mortgage["id"], "name": mortgage["name"]},
        {"id": second_mortgage["id"], "name": second_mortgage["name"]},
    ]
    assert page["items"][1]["paid_on"] == "2026-03-01"


def test_payments_can_be_filtered_by_customer_mortgage_or_reference(
    client, ramesh, mortgage, second_mortgage
):
    sita = person(client, "Sita", "9000000005")
    pay(client, ramesh, {mortgage["id"]: 1_000_00}, on="2026-04-20", reference="UTR9")
    pay(client, ramesh, {second_mortgage["id"]: 1_000_00}, on="2026-04-20")

    def count(q):
        return list_payments(client, q=q)["total"]

    assert count("ramesh") == 2
    assert count("sita") == 0
    assert count("bangles") == 1  # Mortgage Name
    assert count("utr9") == 1
    assert sita  # exists but has no Payments


def test_the_payment_methods_are_published_with_their_names(client) -> None:
    assert client.get("/api/payment-methods").json() == [
        {"method": "cash", "name": "Cash"},
        {"method": "upi", "name": "UPI"},
        {"method": "bank_transfer", "name": "Bank transfer"},
    ]


def test_a_payment_that_leaves_something_outstanding_names_none(
    client, ramesh, mortgage
):
    payment = pay(client, ramesh, {mortgage["id"]: 19_000_00}, on="2026-04-20")

    assert payment["ready_to_redeem"] == []


def test_an_earlier_payment_does_not_name_a_mortgage_a_later_one_left_ready_to_redeem(
    client, ramesh, mortgage
):
    earlier = pay(client, ramesh, {mortgage["id"]: 9_000_00}, on="2026-04-14")
    # ₹1,00,000 left on 14 Apr; the later Payment, the next day, pays it all.
    pay(client, ramesh, {mortgage["id"]: 100_000_00}, on="2026-04-15")

    assert client.get(f"/api/payments/{earlier['id']}").json()["ready_to_redeem"] == []


# Payments pay the Interest to Date before Principal (#69).


def test_a_mid_month_receipt_shows_the_interest_to_date_paid_before_principal(
    client, ramesh, mortgage
):
    # 15 Apr: ₹9,000 charged and ₹3,000 Interest to Date, then Principal.
    payment = pay(client, ramesh, {mortgage["id"]: 15_000_00}, on="2026-04-15")

    [line] = client.get(f"/api/payments/{payment['id']}/receipt").json()["lines"]

    assert (line["interest_paid"], line["principal_paid"], line["owed_after"]) == (
        12_000_00,
        3_000_00,
        97_000_00,
    )


def test_voiding_a_mid_month_payment_restores_the_ledger(client, ramesh, mortgage):
    before = client.get(f"/api/mortgages/{mortgage['id']}").json()
    payment = pay(client, ramesh, {mortgage["id"]: 15_000_00}, on="2026-04-15")

    voided = client.post(
        f"/api/payments/{payment['id']}/void", json={"reason": "Bounced"}
    )

    assert voided.status_code == 200, voided.text
    after = client.get(f"/api/mortgages/{mortgage['id']}").json()
    assert (after["ledger"], after["outstanding"]) == (
        before["ledger"],
        before["outstanding"],
    )


def test_paying_principal_and_charged_interest_on_an_accrual_date_still_owes(
    client, ramesh
):
    # From 20 Mar, accruing today: ₹3,000 charged and the month starting today's ₹3,000
    # (Full-month) come first, so ₹1,03,000 leaves ₹3,000 of Principal owed.
    mortgage = lend(client, ramesh, "2026-03-20")

    pay(client, ramesh, {mortgage["id"]: 103_000_00}, on="2026-04-20")

    page = client.get(f"/api/mortgages/{mortgage['id']}").json()
    assert (page["status"], page["outstanding"]["total"]) == ("active", 3_000_00)
