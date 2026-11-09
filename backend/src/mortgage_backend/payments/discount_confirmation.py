"""The per-Allocation Discount amount above which the Lender is asked to confirm."""

from fastapi import APIRouter
from pydantic import BaseModel, Field
from sqlalchemy.engine import Connection

from mortgage_backend.platform.db import EngineDep
from mortgage_backend.platform.settings import ThresholdSetting

_KEY = "discount_confirmation_limit"
DEFAULT_DISCOUNT_CONFIRMATION_LIMIT = 500 * 100  # paise


class DiscountConfirmationLimit(BaseModel):
    discount_confirmation_limit: int | None = Field(gt=0)  # paise; None: never ask


_DISCOUNT_CONFIRMATION_LIMIT = ThresholdSetting(
    DiscountConfirmationLimit,
    "discount_confirmation_limit",
    _KEY,
    DEFAULT_DISCOUNT_CONFIRMATION_LIMIT,
)


def get_discount_confirmation_limit(conn: Connection) -> DiscountConfirmationLimit:
    return _DISCOUNT_CONFIRMATION_LIMIT.get(conn)


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
        _DISCOUNT_CONFIRMATION_LIMIT.set(conn, setting)
        return get_discount_confirmation_limit(conn)
