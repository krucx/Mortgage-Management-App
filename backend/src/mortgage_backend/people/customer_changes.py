"""Changes to Customers, each made in one place: creating one, editing one, replacing
its photo and deleting it.

Every change is refused if it isn't allowed, written, then recorded in History. The
rules live here: a Primary Number identifies a person (ADR 0005), so a number already
a Customer's is refused, a Standalone Referrer who borrows is promoted to a Customer
with their referrals, and a "new" Referrer whose number is known is that person; nobody
is their own Referrer; and a Customer with Mortgages is never deleted. The request
handlers only parse, call and answer.
"""

from datetime import datetime

from fastapi import APIRouter, HTTPException, Response, UploadFile, status
from sqlalchemy import delete, insert, select, update
from sqlalchemy.engine import Connection

from mortgage_backend.people.customers import (
    Customer,
    CustomerIn,
    ExistingCustomerReferrer,
    ExistingStandaloneReferrer,
    NewStandaloneReferrer,
    PersonSummary,
    ReferrerChoice,
    load_customer,
    owner_of,
)
from mortgage_backend.platform import photos
from mortgage_backend.platform.clock import NowDep
from mortgage_backend.platform.db import (
    EngineDep,
    customer_table,
    exists,
    mortgage_table,
    standalone_referrer_table,
)
from mortgage_backend.platform.errors import unprocessable
from mortgage_backend.platform.photos import PhotosDirDep
from mortgage_backend.safekeeping import audit

_AUDITED = ["name", "address", "phone_1", "phone_2", "referrer"]


def _audited(customer: Customer) -> dict[str, object]:
    """The Customer's details as History records them."""
    return {
        **customer.model_dump(include=set(_AUDITED) - {"referrer"}),
        "referrer": customer.referrer.name if customer.referrer else None,
    }


def _number_taken(phone: str, owner: PersonSummary) -> HTTPException:
    label = "Customer" if owner.kind == "customer" else "Referrer"
    return HTTPException(
        status.HTTP_409_CONFLICT,
        f"Contact number 1 {phone} already belongs to {label} {owner.name}",
    )


def _is_themselves(
    conn: Connection,
    choice: ReferrerChoice | None,
    customer_id: int | None,
    phone_1: str,
    owner: PersonSummary | None,
) -> bool:
    """Whether the chosen Referrer is the Customer themselves: the same Customer, the
    Standalone Referrer they are being promoted from, or a "new" Referrer with their
    number (the one given, or the one they had before an edit)."""
    match choice:
        case ExistingCustomerReferrer(id=referrer_id):
            return referrer_id == customer_id
        case ExistingStandaloneReferrer(id=referrer_id):
            promoting = ("referrer", referrer_id)
            return owner is not None and (owner.kind, owner.id) == promoting
        case NewStandaloneReferrer(phone=phone):
            if phone == phone_1:
                return True
            known = owner_of(conn, phone)
            return known is not None and (known.kind, known.id) == (
                "customer",
                customer_id,
            )
        case _:
            return False


def _link_to(person: PersonSummary | None) -> dict[str, int | None]:
    """The customer row's two referrer columns (at most one set) pointing at
    `person`."""
    return {
        "referred_by_customer_id": person.id
        if person and person.kind == "customer"
        else None,
        "referred_by_standalone_referrer_id": person.id
        if person and person.kind == "referrer"
        else None,
    }


def _referrer_columns(
    conn: Connection, choice: ReferrerChoice | None
) -> dict[str, int | None]:
    """Resolve a Referrer choice to the customer row's referrer columns.

    A "new" Referrer whose number already belongs to someone is linked to that person
    rather than duplicated.
    """
    match choice:
        case None:
            return _link_to(None)
        case ExistingCustomerReferrer(id=referrer_id):
            if not exists(conn, customer_table, referrer_id):
                raise unprocessable("Referrer Customer not found")
            return _link_to(PersonSummary(kind="customer", id=referrer_id, name=""))
        case ExistingStandaloneReferrer(id=referrer_id):
            if not exists(conn, standalone_referrer_table, referrer_id):
                raise unprocessable("Referrer not found")
            return _link_to(PersonSummary(kind="referrer", id=referrer_id, name=""))
        case NewStandaloneReferrer():
            existing = owner_of(conn, choice.phone)
            if existing is not None:
                return _link_to(existing)
            new_id = conn.execute(
                insert(standalone_referrer_table)
                .values(name=choice.name, address=choice.address, phone=choice.phone)
                .returning(standalone_referrer_table.c.id)
            ).scalar_one()
            return _link_to(PersonSummary(kind="referrer", id=new_id, name=choice.name))


def _promote_referrer(conn: Connection, referrer_id: int, customer_id: int) -> None:
    """A Standalone Referrer who became a Customer: move their referrals over, then
    remove them."""
    conn.execute(
        update(customer_table)
        .where(customer_table.c.referred_by_standalone_referrer_id == referrer_id)
        .values(
            referred_by_standalone_referrer_id=None, referred_by_customer_id=customer_id
        )
    )
    conn.execute(
        delete(standalone_referrer_table).where(
            standalone_referrer_table.c.id == referrer_id
        )
    )


def _checked(
    conn: Connection, customer: CustomerIn, customer_id: int | None
) -> tuple[dict[str, object], int | None]:
    """Refuse the details if they cannot stand; else the customer row's values, and the
    Standalone Referrer with this Primary Number, who becomes this new Customer."""
    owner = owner_of(conn, customer.phone_1)
    promoted = None
    if owner is not None:
        if customer_id is None and owner.kind == "referrer":
            promoted = owner.id
        elif (owner.kind, owner.id) != ("customer", customer_id):
            raise _number_taken(customer.phone_1, owner)
    if _is_themselves(conn, customer.referrer, customer_id, customer.phone_1, owner):
        raise unprocessable("A Customer cannot be their own Referrer")
    values = {
        **customer.model_dump(exclude={"referrer"}),
        **_referrer_columns(conn, customer.referrer),
    }
    return values, promoted


def create_customer(conn: Connection, customer: CustomerIn, now: datetime) -> int:
    """Save a new Customer (or refuse); their id."""
    values, promoted = _checked(conn, customer, None)
    customer_id: int = conn.execute(
        insert(customer_table).values(**values).returning(customer_table.c.id)
    ).scalar_one()
    if promoted is not None:
        _promote_referrer(conn, promoted, customer_id)
    audit.record(
        conn,
        now,
        "customer",
        customer_id,
        "created",
        audit.created(_audited(load_customer(conn, customer_id)), _AUDITED),
    )
    return customer_id


def edit_customer(
    conn: Connection, customer_id: int, customer: CustomerIn, now: datetime
) -> None:
    """Save a Customer's edited details (or refuse)."""
    before = load_customer(conn, customer_id)
    values, _ = _checked(conn, customer, customer_id)
    conn.execute(
        update(customer_table)
        .where(customer_table.c.id == customer_id)
        .values(**values)
    )
    changed = audit.changes(
        _audited(before), _audited(load_customer(conn, customer_id)), _AUDITED
    )
    if changed:
        audit.record(conn, now, "customer", customer_id, "edited", changed)


def replace_photo(
    conn: Connection, customer_id: int, file_name: str, now: datetime
) -> str | None:
    """Make `file_name` (already saved) the Customer's photo; the old photo's file, to
    delete once this is saved."""
    load_customer(conn, customer_id)  # refused if there is no such Customer
    old: str | None = conn.execute(
        select(customer_table.c.photo).where(customer_table.c.id == customer_id)
    ).scalar()
    conn.execute(
        update(customer_table)
        .where(customer_table.c.id == customer_id)
        .values(photo=file_name)
    )
    audit.record(conn, now, "customer", customer_id, "photo_added")
    return old


def remove_customer(conn: Connection, customer_id: int, now: datetime) -> str | None:
    """Delete a Customer without Mortgages (or refuse); anyone they referred keeps their
    record but loses the link. Their photo's file, to delete once this is saved."""
    customer = conn.execute(
        select(customer_table.c.name, customer_table.c.photo).where(
            customer_table.c.id == customer_id
        )
    ).first()
    if customer is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Customer not found")
    if conn.execute(
        select(mortgage_table.c.id).where(mortgage_table.c.customer_id == customer_id)
    ).first():
        raise HTTPException(
            status.HTTP_409_CONFLICT, "A Customer with Mortgages cannot be deleted"
        )
    conn.execute(
        update(customer_table)
        .where(customer_table.c.referred_by_customer_id == customer_id)
        .values(referred_by_customer_id=None)
    )
    conn.execute(delete(customer_table).where(customer_table.c.id == customer_id))
    audit.record(conn, now, "customer", customer_id, "deleted", note=customer.name)
    photo: str | None = customer.photo
    return photo


router = APIRouter(prefix="/api")


@router.post("/customers", status_code=status.HTTP_201_CREATED)
def post_customer(customer: CustomerIn, engine: EngineDep, now: NowDep) -> Customer:
    with engine.begin() as conn:
        return load_customer(conn, create_customer(conn, customer, now))


@router.put("/customers/{customer_id}")
def put_customer(
    customer_id: int, customer: CustomerIn, engine: EngineDep, now: NowDep
) -> Customer:
    with engine.begin() as conn:
        edit_customer(conn, customer_id, customer, now)
        return load_customer(conn, customer_id)


@router.put("/customers/{customer_id}/photo")
async def put_customer_photo(
    customer_id: int,
    photo: UploadFile,
    engine: EngineDep,
    photos_dir: PhotosDirDep,
    now: NowDep,
) -> Customer:
    with engine.connect() as conn:
        load_customer(conn, customer_id)  # refused before saving a file for nothing
    content = await photo.read()
    file_name = photos.save_photo(photos_dir, "customer", customer_id, content)
    with engine.begin() as conn:
        old = replace_photo(conn, customer_id, file_name, now)
        saved = load_customer(conn, customer_id)
    photos.delete_photo(photos_dir, old)
    return saved


@router.delete("/customers/{customer_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_customer(
    customer_id: int, engine: EngineDep, photos_dir: PhotosDirDep, now: NowDep
) -> Response:
    """Delete a Customer; anyone they referred keeps their record but loses the link."""
    with engine.begin() as conn:
        photo = remove_customer(conn, customer_id, now)
    photos.delete_photo(photos_dir, photo)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
