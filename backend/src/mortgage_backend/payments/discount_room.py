"""Each Allocation's room for a Discount after its cash (Documentation/GLOSSARY.md),
for the Payment Preview: a Discount larger than its room is capped before the Payment
is hypothetically recorded, so the Preview reports the room instead of refusing for it."""

from sqlalchemy.engine import Connection

from mortgage_backend.lending.changes import PaymentIn
from mortgage_backend.lending.replay import replay


def discount_rooms(conn: Connection, payment: PaymentIn) -> dict[int, int]:
    """Each Allocation's room for a Discount, by Mortgage id: what is owed on the
    Payment date, less its cash (never negative)."""
    return {
        allocation.mortgage_id: max(
            0,
            replay(conn, allocation.mortgage_id).outstanding(payment.paid_on).total
            - allocation.amount,
        )
        for allocation in payment.allocations
    }


def capped(payment: PaymentIn, rooms: dict[int, int]) -> PaymentIn:
    """`payment`, each Allocation's Discount capped to its room."""
    return payment.model_copy(
        update={
            "allocations": [
                allocation.model_copy(
                    update={
                        "discount": min(
                            allocation.discount, rooms[allocation.mortgage_id]
                        )
                    }
                )
                for allocation in payment.allocations
            ]
        }
    )
