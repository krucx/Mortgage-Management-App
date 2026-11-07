"""The per-Allocation Discount amount above which the Lender is asked to confirm."""

from fastapi import APIRouter
from pydantic import BaseModel, Field
from sqlalchemy.engine import Connection

from mortgage_backend.platform.db import EngineDep, get_config, set_config

_KEY = "discount_confirmation_limit"
DEFAULT_DISCOUNT_CONFIRMATION_LIMIT = 500 * 100  # paise


class DiscountConfirmationLimit(BaseModel):
    discount_confirmation_limit: int | None = Field(gt=0)  # paise; None: never ask


def get_discount_confirmation_limit(conn: Connection) -> DiscountConfirmationLimit:
    stored = get_config(conn, [_KEY]).get(_KEY)
    if stored is None:
        return DiscountConfirmationLimit(
            discount_confirmation_limit=DEFAULT_DISCOUNT_CONFIRMATION_LIMIT
        )
    return DiscountConfirmationLimit(
        discount_confirmation_limit=int(stored) if stored else None
    )


router = APIRouter(prefix="/api")


@router.get("/settings/discount-confirmation-limit")
def read_discount_confirmation_limit(engine: EngineDep) -> DiscountConfirmationLimit:
    with engine.connect() as conn:
        return get_discount_confirmation_limit(conn)


@router.put("/settings/discount-confirmation-limit")
def update_discount_confirmation_limit(
    setting: DiscountConfirmationLimit, engine: EngineDep
) -> DiscountConfirmationLimit:
    with engine.begin() as conn:
        value = setting.discount_confirmation_limit
        set_config(conn, _KEY, "" if value is None else str(value))
        return get_discount_confirmation_limit(conn)
