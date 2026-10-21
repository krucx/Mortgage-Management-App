"""The Primary Number (a Customer's contact number 1, a Standalone Referrer's phone)
identifies a person: no two people share one."""

RAMESH = {"name": "Ramesh Kumar", "address": "Jaipur", "phone_1": "9829012345"}
MOHAN = {
    "kind": "new",
    "name": "Mohan Lal",
    "address": "Johari Bazaar",
    "phone": "9414099999",
}


def create(client, **fields):
    response = client.post("/api/customers", json={**RAMESH, **fields})
    assert response.status_code == 201, response.text
    return response.json()


def test_a_second_customer_cannot_take_someone_elses_contact_number_1(client):
    create(client)

    response = client.post(
        "/api/customers",
        json={**RAMESH, "name": "Somebody Else", "phone_1": "+91 98290 12345"},
    )

    assert response.status_code == 409
    assert "Ramesh Kumar" in response.json()["detail"]


def test_the_same_name_with_a_different_number_is_a_different_customer(client):
    create(client)
    create(client, phone_1="9000000001")

    assert client.get("/api/customers").json()["total"] == 2


def test_editing_contact_number_1_to_another_persons_number_is_rejected(client):
    create(client)
    suresh = create(client, name="Suresh", phone_1="9000000002")

    response = client.put(
        f"/api/customers/{suresh['id']}", json={**RAMESH, "name": "Suresh"}
    )

    assert response.status_code == 409
    assert (
        client.get(f"/api/customers/{suresh['id']}").json()["phone_1"] == "9000000002"
    )


def test_editing_contact_number_1_to_a_standalone_referrers_number_is_rejected(client):
    create(client, referrer=MOHAN)
    suresh = create(client, name="Suresh", phone_1="9000000002")

    response = client.put(
        f"/api/customers/{suresh['id']}",
        json={**RAMESH, "name": "Suresh", "phone_1": "9414099999"},
    )

    assert response.status_code == 409
    assert "Mohan Lal" in response.json()["detail"]


def test_contact_number_2_may_repeat_another_persons_number(client):
    create(client)

    create(client, name="Sita", phone_1="9000000005", phone_2="9829012345")


def test_a_new_referrer_whose_number_belongs_to_a_customer_is_linked_to_that_customer(
    client,
):
    ramesh = create(client)

    sita = create(
        client,
        name="Sita",
        phone_1="9000000005",
        referrer={
            "kind": "new",
            "name": "Ramesh K",
            "address": "",
            "phone": "98290 12345",
        },
    )

    assert sita["referrer"] == {
        "kind": "customer",
        "id": ramesh["id"],
        "name": "Ramesh Kumar",
    }
    assert (
        client.get("/api/search", params={"q": "Ramesh K"}).json()[0]["kind"]
        == "customer"
    )
    assert len(client.get("/api/search", params={"q": "9829012345"}).json()) == 1


def test_a_new_referrer_whose_number_belongs_to_a_standalone_referrer_reuses_them(
    client,
):
    first = create(client, referrer=MOHAN)

    second = create(
        client,
        name="Geeta",
        phone_1="9000000003",
        referrer={**MOHAN, "name": "Mohan"},
    )

    assert second["referrer"] == first["referrer"]
    assert len(client.get("/api/search", params={"q": "9414099999"}).json()) == 1


def test_a_customer_created_on_a_standalone_referrers_number_promotes_them(client):
    geeta = create(client, name="Geeta", phone_1="9000000003", referrer=MOHAN)
    referrer_id = geeta["referrer"]["id"]

    mohan = create(
        client, name="Mohan Lal", phone_1="9414099999", address="Johari Bazaar"
    )

    assert client.get(f"/api/referrers/{referrer_id}").status_code == 404
    assert [person["name"] for person in mohan["referred"]] == ["Geeta"]
    geeta_now = client.get(f"/api/customers/{geeta['id']}").json()
    assert geeta_now["referrer"] == {
        "kind": "customer",
        "id": mohan["id"],
        "name": "Mohan Lal",
    }
    assert [
        hit["kind"] for hit in client.get("/api/search", params={"q": "mohan"}).json()
    ] == ["customer"]


def test_a_customer_cannot_be_their_own_referrer_by_number(client):
    response = client.post(
        "/api/customers",
        json={**RAMESH, "referrer": {**MOHAN, "phone": RAMESH["phone_1"]}},
    )

    assert response.status_code == 422


def test_a_promoted_referrer_cannot_be_their_own_referrer(client):
    geeta = create(client, name="Geeta", phone_1="9000000003", referrer=MOHAN)

    response = client.post(
        "/api/customers",
        json={
            **RAMESH,
            "name": "Mohan Lal",
            "phone_1": "9414099999",
            "referrer": {"kind": "referrer", "id": geeta["referrer"]["id"]},
        },
    )

    assert response.status_code == 422


def owner(client, phone):
    response = client.get("/api/people/by-phone", params={"phone": phone})
    assert response.status_code == 200
    return response.json()


def test_lender_can_look_up_who_a_number_belongs_to(client):
    ramesh = create(client, referrer=MOHAN)

    assert owner(client, "+91 98290 12345") == {
        "kind": "customer",
        "id": ramesh["id"],
        "name": "Ramesh Kumar",
    }
    assert owner(client, "9414099999")["kind"] == "referrer"
    assert owner(client, "9000000000") is None
    assert owner(client, "123") is None


def test_the_preview_of_saving_a_customer_gives_the_same_refusal_and_saves_nothing(
    client,
):
    create(client, referrer=MOHAN)
    suresh = create(client, name="Suresh", phone_1="9000000002")
    taken = {**RAMESH, "name": "Suresh", "phone_1": "9414099999"}

    # Editing onto a Standalone Referrer's number is refused, as saving would be.
    edit = client.put(f"/api/customers/{suresh['id']}/preview", json=taken)
    # A new Customer on another Customer's number too.
    new = client.post("/api/customers/preview", json={**RAMESH, "name": "Duplicate"})

    assert (edit.status_code, new.status_code) == (409, 409)
    assert "Mohan Lal" in edit.json()["detail"]
    assert "Ramesh Kumar" in new.json()["detail"]
    assert client.get(f"/api/customers/{suresh['id']}").json()["phone_1"] == "9000000002"


def test_the_preview_of_saving_a_customer_that_would_save_saves_nothing(client):
    response = client.post("/api/customers/preview", json=RAMESH)

    assert response.status_code == 204
    assert client.get("/api/customers").json()["total"] == 0
