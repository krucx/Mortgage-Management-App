RAMESH = {
    "name": "Ramesh Kumar",
    "address": "12 MG Road, Jaipur",
    "phone_1": "98290 12345",
    "phone_2": None,
    "referrer": None,
}


def create_customer(client, **overrides):
    response = client.post("/api/customers", json={**RAMESH, **overrides})
    assert response.status_code == 201, response.text
    return response.json()


def test_lender_can_create_a_customer_and_open_their_page(client):
    created = create_customer(client)

    page = client.get(f"/api/customers/{created['id']}").json()

    assert page["name"] == "Ramesh Kumar"
    assert page["address"] == "12 MG Road, Jaipur"
    assert page["phone_1"] == "9829012345"
    assert page["phone_2"] is None
    assert page["photo_url"] is None
    assert page["referrer"] is None


import pytest


@pytest.mark.parametrize(
    ("typed", "stored"),
    [
        ("9829012345", "9829012345"),
        ("+91 98290 12345", "9829012345"),
        ("91-98290-12345", "9829012345"),
        ("098290 12345", "9829012345"),
    ],
)
def test_phone_numbers_are_stored_as_10_digit_mobiles(client, typed, stored):
    customer = create_customer(client, phone_1=typed, phone_2=typed)

    assert customer["phone_1"] == stored
    assert customer["phone_2"] == stored


@pytest.mark.parametrize("bad_phone", ["12345", "98290123456789", "call me", ""])
def test_a_phone_that_is_not_a_10_digit_mobile_is_rejected(client, bad_phone):
    response = client.post("/api/customers", json={**RAMESH, "phone_1": bad_phone})

    assert response.status_code == 422


def test_name_is_required(client):
    response = client.post("/api/customers", json={**RAMESH, "name": ""})

    assert response.status_code == 422


def test_opening_a_customer_that_does_not_exist_is_404(client):
    assert client.get("/api/customers/999").status_code == 404


def test_a_customer_can_be_referred_by_an_existing_customer(client):
    ramesh = create_customer(client)

    suresh = create_customer(
        client,
        name="Suresh",
        phone_1="9000000002",
        referrer={"kind": "customer", "id": ramesh["id"]},
    )

    assert suresh["referrer"] == {
        "kind": "customer",
        "id": ramesh["id"],
        "name": "Ramesh Kumar",
    }


def test_a_customer_can_be_referred_by_a_new_standalone_referrer(client):
    suresh = create_customer(
        client,
        name="Suresh",
        referrer={
            "kind": "new",
            "name": "Mohan Lal",
            "address": "Johari Bazaar",
            "phone": "9000000009",
        },
    )

    referrer = suresh["referrer"]
    assert referrer["kind"] == "referrer"
    assert referrer["name"] == "Mohan Lal"


def test_a_standalone_referrer_can_be_picked_again_for_another_customer(client):
    first = create_customer(
        client,
        referrer={
            "kind": "new",
            "name": "Mohan Lal",
            "address": "Johari Bazaar",
            "phone": "9000000009",
        },
    )
    mohan_id = first["referrer"]["id"]

    second = create_customer(
        client,
        name="Geeta",
        phone_1="9000000003",
        referrer={"kind": "referrer", "id": mohan_id},
    )

    assert second["referrer"] == {
        "kind": "referrer",
        "id": mohan_id,
        "name": "Mohan Lal",
    }


@pytest.mark.parametrize("kind", ["customer", "referrer"])
def test_picking_a_referrer_that_does_not_exist_is_rejected(client, kind):
    response = client.post(
        "/api/customers", json={**RAMESH, "referrer": {"kind": kind, "id": 999}}
    )

    assert response.status_code == 422


def test_lender_can_edit_a_customers_details(client):
    ramesh = create_customer(client)
    mohan = create_customer(client, name="Mohan", phone_1="9000000009")

    response = client.put(
        f"/api/customers/{ramesh['id']}",
        json={
            **RAMESH,
            "address": "44 Station Road, Jaipur",
            "phone_2": "9000000001",
            "referrer": {"kind": "customer", "id": mohan["id"]},
        },
    )

    assert response.status_code == 200
    page = client.get(f"/api/customers/{ramesh['id']}").json()
    assert page["address"] == "44 Station Road, Jaipur"
    assert page["phone_2"] == "9000000001"
    assert page["referrer"]["name"] == "Mohan"


def test_a_customer_cannot_be_their_own_referrer(client):
    ramesh = create_customer(client)

    response = client.put(
        f"/api/customers/{ramesh['id']}",
        json={**RAMESH, "referrer": {"kind": "customer", "id": ramesh["id"]}},
    )

    assert response.status_code == 422


def test_editing_a_customer_that_does_not_exist_is_404(client):
    assert client.put("/api/customers/999", json=RAMESH).status_code == 404


def test_a_customers_page_lists_the_customers_they_referred(client):
    ramesh = create_customer(client)
    for name, phone in [("Suresh", "9000000002"), ("Geeta", "9000000003")]:
        create_customer(
            client,
            name=name,
            phone_1=phone,
            referrer={"kind": "customer", "id": ramesh["id"]},
        )
    create_customer(client, name="Unrelated", phone_1="9000000004")

    page = client.get(f"/api/customers/{ramesh['id']}").json()

    assert [person["name"] for person in page["referred"]] == ["Geeta", "Suresh"]


def test_a_standalone_referrers_page_lists_the_customers_they_referred(client):
    suresh = create_customer(
        client,
        name="Suresh",
        referrer={
            "kind": "new",
            "name": "Mohan Lal",
            "address": "Johari Bazaar",
            "phone": "9000000009",
        },
    )
    mohan_id = suresh["referrer"]["id"]
    create_customer(
        client,
        name="Geeta",
        phone_1="9000000003",
        referrer={"kind": "referrer", "id": mohan_id},
    )

    page = client.get(f"/api/referrers/{mohan_id}").json()

    assert page["name"] == "Mohan Lal"
    assert page["address"] == "Johari Bazaar"
    assert page["phone"] == "9000000009"
    assert [person["name"] for person in page["referred"]] == ["Geeta", "Suresh"]


def test_opening_a_referrer_that_does_not_exist_is_404(client):
    assert client.get("/api/referrers/999").status_code == 404


def test_reusing_another_customers_phone_is_allowed_but_flagged(client):
    ramesh = create_customer(client, phone_1="9829012345")
    create_customer(client, name="Unrelated", phone_1="9000000004")

    # Same number typed differently, and as the second contact number.
    sita = create_customer(
        client, name="Sita", phone_1="9000000005", phone_2="+91 98290 12345"
    )

    assert sita["shares_phone_with"] == [
        {"kind": "customer", "id": ramesh["id"], "name": "Ramesh Kumar"}
    ]
    ramesh_page = client.get(f"/api/customers/{ramesh['id']}").json()
    assert [person["name"] for person in ramesh_page["shares_phone_with"]] == ["Sita"]


def test_a_customer_with_a_unique_phone_has_no_warning(client):
    assert create_customer(client)["shares_phone_with"] == []


@pytest.fixture
def people(client):
    ramesh = create_customer(client, name="Ramesh Kumar", phone_1="9829012345")
    create_customer(
        client,
        name="Rameshwari Devi",
        phone_1="9000000006",
        referrer={
            "kind": "new",
            "name": "Mohan Lal",
            "address": "Johari Bazaar",
            "phone": "9414099999",
        },
    )
    create_customer(client, name="Geeta", phone_1="9000000003", phone_2="9829055555")
    return {"ramesh": ramesh}


def search(client, query):
    response = client.get("/api/search", params={"q": query})
    assert response.status_code == 200
    return [(hit["kind"], hit["name"]) for hit in response.json()]


def test_search_by_part_of_a_name_ignores_case(client, people):
    assert search(client, "rAmEsH") == [
        ("customer", "Ramesh Kumar"),
        ("customer", "Rameshwari Devi"),
    ]


def test_search_finds_standalone_referrers_too(client, people):
    assert search(client, "mohan") == [("referrer", "Mohan Lal")]


def test_search_by_phone_matches_either_number_however_it_is_typed(client, people):
    assert search(client, "98290") == [
        ("customer", "Geeta"),
        ("customer", "Ramesh Kumar"),
    ]
    assert search(client, "+91 94140 99999") == [("referrer", "Mohan Lal")]


def test_search_results_carry_what_the_list_needs(client, people):
    hit = client.get("/api/search", params={"q": "Ramesh Kumar"}).json()[0]

    assert hit == {
        "kind": "customer",
        "id": people["ramesh"]["id"],
        "name": "Ramesh Kumar",
        "phone": "9829012345",
        "photo_url": None,
    }


def test_blank_search_finds_nothing(client, people):
    assert search(client, "  ") == []
