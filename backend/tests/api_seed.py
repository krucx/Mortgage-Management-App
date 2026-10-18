"""Test data made through the HTTP interface, for tests of it: the requests the
frontend sends, failing the test at once if the app refuses one. Amounts are in paise.

(Not `http.py`: the tests folder is on the import path, and that would hide Python's
own `http`.)
"""

from typing import Any

import seed
from fastapi.testclient import TestClient
from seed import LAKH, RUPEE

# A small Mortgage, for lists of many: ₹10,000 against a 5 g ring.
RING = {"amount": 10_000 * RUPEE, "description": "Gold ring", "net_weight_mg": 5_000}

# ₹3,000 a month on ₹1,00,000, never capitalised; a full month charged on redemption.
SIMPLE_3 = seed.SIMPLE_3.model_dump(mode="json")


def _created(response: Any) -> Any:
    assert response.status_code == 201, response.text
    return response.json()


def person(
    client: TestClient,
    name: str = "Ramesh Kumar",
    phone: str = "9829012345",
    **fields: Any,
) -> Any:
    """A new Customer, by name and Primary Number (`fields`: address, referrer…)."""
    details = {"name": name, "address": "", "phone_1": phone, **fields}
    return _created(client.post("/api/customers", json=details))


def nth_person(
    client: TestClient, n: int, name: str | None = None, **fields: Any
) -> Any:
    """The `n`th of a crowd of Customers, each with a Primary Number of their own:
    "Customer 01", "Customer 02"… unless `name` is given."""
    return person(client, name or f"Customer {n:02d}", f"98290{n:05d}", **fields)


def lend(
    client: TestClient,
    owner: Any,
    start: str = "2026-01-14",
    amount: int = LAKH,
    description: str = "Gold chain",
    net_weight_mg: int = 19_000,
    terms: Any = SIMPLE_3,
    **fields: Any,
) -> Any:
    """A new Mortgage for `owner` (a Customer as the API returns them), of 22K gold
    with a gram of stones; `fields` adds or overrides anything else (a name…)."""
    details = {
        "customer_id": owner["id"],
        "start_date": start,
        "amount_lent": amount,
        "description": description,
        "gross_weight_mg": net_weight_mg + 1_000,
        "net_weight_mg": net_weight_mg,
        "purity_karat": 22,
        "terms": terms,
        **fields,
    }
    return _created(client.post("/api/mortgages", json=details))


def pay(
    client: TestClient,
    owner: Any,
    allocations: dict[int, int],
    on: str = "2026-04-15",
    method: str = "cash",
    **fields: Any,
) -> Any:
    """A Payment from `owner` of `allocations` (amount by Mortgage id), on `on`."""
    details = {
        "customer_id": owner["id"],
        "paid_on": on,
        "amount": sum(allocations.values()),
        "method": method,
        "allocations": [
            {"mortgage_id": mortgage_id, "amount": amount}
            for mortgage_id, amount in allocations.items()
        ],
        **fields,
    }
    return _created(client.post("/api/payments", json=details))
