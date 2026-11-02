"""A Customer's optional email, Aadhaar Number (the last 4 digits only), PAN and ID
Photos (see GLOSSARY.md)."""

import io

import pytest
from api_seed import person
from PIL import Image


def details(**fields):
    return {"name": "Ramesh Kumar", "address": "", "phone_1": "9829012345", **fields}


def saved(response):
    assert response.status_code in (200, 201), response.text
    return response.json()


def history(client, customer):
    return [
        (e["action"], e["field"], e["old_value"], e["new_value"], e["note"])
        for e in client.get(f"/api/customers/{customer['id']}/history").json()
    ]


def test_a_customer_may_have_an_email_aadhaar_number_and_pan(client):
    ramesh = saved(
        client.post(
            "/api/customers",
            json=details(
                email=" Ramesh@Example.com ", aadhaar_last4="1234", pan="abcde1234f"
            ),
        )
    )

    assert (ramesh["email"], ramesh["aadhaar_last4"], ramesh["pan"]) == (
        "Ramesh@Example.com",
        "1234",
        "ABCDE1234F",
    )
    assert ("created", "pan", None, "ABCDE1234F", None) in history(client, ramesh)


def test_none_of_them_is_needed(client):
    ramesh = person(client)

    assert (ramesh["email"], ramesh["aadhaar_last4"], ramesh["pan"]) == (None,) * 3
    assert (ramesh["aadhaar_photo_url"], ramesh["pan_photo_url"]) == (None, None)


@pytest.mark.parametrize("typed", ["1234 5678 9012", "XXXX XXXX 9012", "9012"])
def test_only_the_last_four_aadhaar_digits_are_ever_kept(client, typed):
    ramesh = saved(client.post("/api/customers", json=details(aadhaar_last4=typed)))

    assert ramesh["aadhaar_last4"] == "9012"
    assert "1234 5678" not in str(history(client, ramesh))


@pytest.mark.parametrize(
    ("fields", "why"),
    [
        ({"email": "ramesh@"}, "email"),
        ({"pan": "ABCD1234F"}, "PAN"),
        ({"aadhaar_last4": "12"}, "Aadhaar"),
    ],
)
def test_a_malformed_email_pan_or_aadhaar_number_is_refused(client, fields, why):
    response = client.post("/api/customers", json=details(**fields))

    assert response.status_code == 422
    assert why in response.text


def test_a_pan_already_on_another_customer_is_refused_naming_them(client):
    saved(client.post("/api/customers", json=details(pan="ABCDE1234F")))

    response = client.post(
        "/api/customers",
        json=details(name="Suresh Kumar", phone_1="9829054321", pan="abcde1234f"),
    )

    assert response.status_code == 409
    assert (
        response.json()["detail"]
        == "PAN ABCDE1234F already belongs to Customer Ramesh Kumar"
    )


def test_an_edit_sets_and_clears_them_and_history_keeps_both(client):
    ramesh = person(client)
    edited = saved(
        client.put(f"/api/customers/{ramesh['id']}", json=details(email="r@k.in"))
    )
    cleared = saved(client.put(f"/api/customers/{ramesh['id']}", json=details()))

    assert (edited["email"], cleared["email"]) == ("r@k.in", None)
    assert ("edited", "email", None, "r@k.in", None) in history(client, ramesh)
    assert ("edited", "email", "r@k.in", None, None) in history(client, ramesh)


def jpeg() -> bytes:
    out = io.BytesIO()
    Image.new("RGB", (40, 25), "white").save(out, "JPEG")
    return out.getvalue()


def put_id_photo(client, customer, card):
    return client.put(
        f"/api/customers/{customer['id']}/id-photos/{card}",
        files={"photo": ("card.jpg", jpeg(), "image/jpeg")},
    )


def test_id_photos_are_added_replaced_and_removed_and_recorded(client):
    ramesh = person(client)

    with_aadhaar = saved(put_id_photo(client, ramesh, "aadhaar"))
    with_both = saved(put_id_photo(client, ramesh, "pan"))
    replaced = saved(put_id_photo(client, ramesh, "pan"))
    removed = saved(client.delete(f"/api/customers/{ramesh['id']}/id-photos/aadhaar"))

    assert with_aadhaar["aadhaar_photo_url"].startswith("/api/photos/")
    assert (
        with_both["pan_photo_url"]
        and replaced["pan_photo_url"] != with_both["pan_photo_url"]
    )
    assert removed["aadhaar_photo_url"] is None
    assert (
        client.get(with_both["pan_photo_url"]).status_code == 404
    )  # the old file is gone
    actions = [(a, note) for a, _, _, _, note in history(client, ramesh)]
    assert ("photo_added", "Aadhaar card") in actions
    assert ("photo_removed", "Aadhaar card") in actions
    assert actions.count(("photo_added", "PAN card")) == 2


def test_id_photos_are_never_in_the_customers_list(client):
    ramesh = person(client)
    put_id_photo(client, ramesh, "pan")

    [listed] = client.get("/api/customers").json()["items"]

    assert "pan_photo_url" not in listed and "pan" not in listed


def test_a_deleted_customer_takes_their_id_photos_with_them(client):
    ramesh = person(client)
    url = saved(put_id_photo(client, ramesh, "aadhaar"))["aadhaar_photo_url"]

    assert client.delete(f"/api/customers/{ramesh['id']}").status_code == 204
    assert client.get(url).status_code == 404
