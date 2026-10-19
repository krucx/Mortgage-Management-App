import pytest
from api_seed import person
from seed import LAKH


@pytest.fixture
def ramesh(client):
    return person(client, address="Jaipur")


def mortgage_fields(customer, **overrides):
    return {
        "customer_id": customer["id"],
        "name": "2026-Ramesh-GoldChain",
        "start_date": "2026-01-14",
        "amount_lent": LAKH,
        "description": "Gold chain with pendant",
        "gross_weight_mg": 25_400,
        "net_weight_mg": 24_100,
        "purity_karat": 22,
        **overrides,
    }


def create_mortgage(client, customer, **overrides):
    response = client.post(
        "/api/mortgages", json=mortgage_fields(customer, **overrides)
    )
    assert response.status_code == 201, response.text
    return response.json()


def test_a_new_mortgage_copies_the_default_terms(client, ramesh):
    mortgage = create_mortgage(client, ramesh)

    assert mortgage["terms"] == {
        "monthly_rate_bps": 300,
        "interest_mode": "compounded_yearly",
        "part_month_rule": "full_month",
    }
    assert mortgage["status"] == "active"
    assert mortgage["customer"] == {
        "kind": "customer",
        "id": ramesh["id"],
        "name": "Ramesh Kumar",
    }


def test_terms_can_be_set_on_the_form(client, ramesh):
    terms = {
        "monthly_rate_bps": 250,
        "interest_mode": "simple",
        "part_month_rule": "pro_rata",
    }

    assert create_mortgage(client, ramesh, terms=terms)["terms"] == terms


def test_changing_default_terms_later_never_changes_an_existing_mortgage(
    client, ramesh
):
    mortgage = create_mortgage(client, ramesh)

    client.put(
        "/api/settings/default-terms",
        json={
            "monthly_rate_bps": 200,
            "interest_mode": "simple",
            "part_month_rule": "nothing",
        },
    )

    assert (
        client.get(f"/api/mortgages/{mortgage['id']}").json()["terms"][
            "monthly_rate_bps"
        ]
        == 300
    )


def test_the_mortgage_page_shows_its_ledger_up_to_today(client, ramesh):
    # Started 14 Jan; today is 20 Apr → interest on 14 Feb, 14 Mar, 14 Apr.
    mortgage = create_mortgage(client, ramesh)

    page = client.get(f"/api/mortgages/{mortgage['id']}").json()

    assert page["as_of"] == "2026-04-20"
    assert [(step["on"], step["event"], step["amount"]) for step in page["ledger"]] == [
        ("2026-01-14", "started", LAKH),
        ("2026-02-14", "interest", 3_000_00),
        ("2026-03-14", "interest", 3_000_00),
        ("2026-04-14", "interest", 3_000_00),
    ]
    assert page["outstanding"] == {
        "principal": LAKH,
        "unpaid_interest": 9_000_00,
        "total": 109_000_00,
    }


def test_the_mortgage_name_is_suggested_from_year_first_name_and_description(
    client, ramesh
):
    response = client.get(
        "/api/mortgages/suggested-name",
        params={
            "customer_id": ramesh["id"],
            "start_date": "2026-01-14",
            "description": "gold chain, 22K",
        },
    )

    assert response.json() == {"name": "2026-Ramesh-GoldChain22K"}


def test_a_suggested_name_that_is_taken_gets_a_numbered_suffix(client, ramesh):
    first = create_mortgage(client, ramesh, name=None, description="Gold chain")

    second = create_mortgage(client, ramesh, name=None, description="Gold chain")
    suggestion = client.get(
        "/api/mortgages/suggested-name",
        params={
            "customer_id": ramesh["id"],
            "start_date": "2026-01-14",
            "description": "gold chain",
        },
    ).json()

    assert first["name"] == "2026-Ramesh-GoldChain"
    assert second["name"] == "2026-Ramesh-GoldChain-2"
    assert suggestion == {"name": "2026-Ramesh-GoldChain-3"}


def test_a_typed_name_that_is_taken_is_refused_not_renamed(client, ramesh):
    create_mortgage(client, ramesh, name="2026-Ramesh-GoldChain")

    response = client.post(
        "/api/mortgages", json=mortgage_fields(ramesh, name="2026-ramesh-GOLDCHAIN")
    )

    assert response.status_code == 409
    assert "already used" in response.json()["detail"]


@pytest.mark.parametrize(
    "bad",
    [
        {"name": "2025-Ramesh-GoldChain"},  # must start with the start year
        {"name": "GoldChain"},
        {"start_date": "2026-04-21"},  # after today
        {"amount_lent": 0},
        {"net_weight_mg": 30_000},  # more than gross
        {"gross_weight_mg": 0, "net_weight_mg": 0},
        {"purity_karat": 21},
        {"customer_id": 999},
        {
            "terms": {
                "monthly_rate_bps": 0,
                "interest_mode": "simple",
                "part_month_rule": "nothing",
            }
        },
    ],
)
def test_invalid_mortgages_are_rejected(client, ramesh, bad):
    response = client.post("/api/mortgages", json=mortgage_fields(ramesh, **bad))

    assert response.status_code == 422


def test_opening_a_mortgage_that_does_not_exist_is_404(client):
    assert client.get("/api/mortgages/999").status_code == 404


def test_mortgages_can_be_searched_by_name_or_customer(client, ramesh):
    sita = client.post(
        "/api/customers", json={"name": "Sita", "address": "", "phone_1": "9000000005"}
    ).json()
    create_mortgage(client, ramesh)
    create_mortgage(client, sita, name="2026-Sita-Bangles", description="Two bangles")

    def names(**params):
        return [
            row["name"]
            for row in client.get("/api/mortgages", params=params).json()["items"]
        ]

    assert names(q="bangles") == ["2026-Sita-Bangles"]
    assert names(q="ramesh") == ["2026-Ramesh-GoldChain"]
    assert names(customer_id=sita["id"]) == ["2026-Sita-Bangles"]
    assert names(customer_id=sita["id"], status="active") == ["2026-Sita-Bangles"]
    assert names() == ["2026-Ramesh-GoldChain", "2026-Sita-Bangles"]


def test_mortgages_can_be_searched_by_the_customers_primary_number(client, ramesh):
    sita = client.post(
        "/api/customers",
        json={"name": "Sita", "address": "", "phone_1": "9000000005", "phone_2": "9414000006"},
    ).json()
    create_mortgage(client, ramesh)
    create_mortgage(client, sita, name="2026-Sita-Bangles", description="Two bangles")

    def names(q):
        return [
            row["name"]
            for row in client.get("/api/mortgages", params={"q": q}).json()["items"]
        ]

    assert names("+91 90000-00005") == ["2026-Sita-Bangles"]
    assert names("09000-000005") == ["2026-Sita-Bangles"]
    assert names("00005") == ["2026-Sita-Bangles"]  # part of it
    assert names("9414000006") == []  # only the Primary Number, not Contact number 2
    # Digits that are also a Mortgage Name's year still find it.
    assert names("2026") == ["2026-Ramesh-GoldChain", "2026-Sita-Bangles"]


def test_listed_mortgages_show_what_is_outstanding(client, ramesh):
    create_mortgage(client, ramesh)

    row = client.get("/api/mortgages").json()["items"][0]

    assert row["customer"]["name"] == "Ramesh Kumar"
    assert row["start_date"] == "2026-01-14"
    assert row["amount_lent"] == LAKH
    assert row["outstanding_total"] == 109_000_00
    assert row["status"] == "active"


def test_a_customer_with_mortgages_cannot_be_deleted(client, ramesh):
    create_mortgage(client, ramesh)

    response = client.delete(f"/api/customers/{ramesh['id']}")

    assert response.status_code == 409
    assert client.get(f"/api/customers/{ramesh['id']}").status_code == 200


def test_filler_words_are_skipped_in_the_suggested_name(client, ramesh):
    response = client.get(
        "/api/mortgages/suggested-name",
        params={
            "customer_id": ramesh["id"],
            "start_date": "2026-01-14",
            "description": "Gold chain with a pendant",
        },
    )

    assert response.json() == {"name": "2026-Ramesh-GoldChainPendant"}
