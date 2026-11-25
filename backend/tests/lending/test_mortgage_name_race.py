"""Customers lent against at the same moment, whose suggested Mortgage Names would be the
same, each get a name of their own: the name is picked and used under one write lock (#549)."""

from concurrent.futures import ThreadPoolExecutor

import pytest
from api_seed import nth_person
from seed import LAKH

CUSTOMERS = 8


def fields(customer: dict) -> dict:
    """No name, so each is suggested "2026-Customer-GoldChain": the same for all."""
    return {
        "customer_id": customer["id"],
        "start_date": "2026-01-14",
        "amount_lent": LAKH,
        "description": "Gold chain",
        "gross_weight_mg": 25_400,
        "net_weight_mg": 24_100,
        "purity_karat": 22,
        "lent_through": "upi",
    }


@pytest.fixture
def customers(client):
    return [nth_person(client, n) for n in range(1, CUSTOMERS + 1)]


@pytest.mark.parametrize("path", ["/api/mortgages", "/api/mortgages/preview"])
def test_parallel_creates_with_the_same_suggested_name_all_succeed(
    client, customers, path
):
    def create(customer):
        return client.post(path, json=fields(customer))

    for _ in range(5):  # a race: one round may slip through
        with ThreadPoolExecutor(CUSTOMERS) as pool:
            responses = list(pool.map(create, customers))
        assert [r.status_code for r in responses] == [
            201 if path == "/api/mortgages" else 200
        ] * CUSTOMERS, [r.text for r in responses]
        if path == "/api/mortgages":
            names = [r.json()["name"] for r in responses]
            assert len(set(names)) == len(names)
        _clear(client)


def _clear(client):
    """A new round starts with no Mortgages (void would keep their names), so delete them."""
    for item in client.get("/api/mortgages", params={"page_size": 100}).json()["items"]:
        client.delete(f"/api/mortgages/{item['id']}")
