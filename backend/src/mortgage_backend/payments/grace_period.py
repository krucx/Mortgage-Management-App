"""The Grace Period (see Documentation/GLOSSARY.md): the days after an Accrual Date within
which a Payment may be dated the day before it, as if paid on time. One setting for the
whole book, not part of any Mortgage's Terms; off unless the Lender sets it."""

from fastapi import APIRouter
from pydantic import (
    BaseModel,
    ValidationError,
    ValidatorFunctionWrapHandler,
    field_validator,
)
from sqlalchemy.engine import Connection

from mortgage_backend.platform.clock import TodayDep
from mortgage_backend.platform.db import EngineDep
from mortgage_backend.platform.settings import ConfigGroup


class GracePeriod(BaseModel):
    grace_period_days: int | None = None  # None: no Grace

    @field_validator("grace_period_days", mode="wrap")
    @classmethod
    def whole_days(
        cls, days: object, as_days: ValidatorFunctionWrapHandler
    ) -> int | None:
        """0 days is no Grace, as is none; anything but a whole number of days is refused."""
        refused = ValueError("The Grace Period must be a whole number of days, 0 or more")
        try:
            whole: int | None = as_days(days)
        except ValidationError:
            raise refused from None
        if whole is not None and whole < 0:
            raise refused
        return whole or None


# Nothing stored means off, so clearing it can simply forget it.
_GRACE_PERIOD = ConfigGroup(GracePeriod, {"grace_period_days": "grace_period_days"})


def get_grace_period(conn: Connection) -> GracePeriod:
    return _GRACE_PERIOD.get(conn)


router = APIRouter(prefix="/api")


@router.get("/settings/grace-period")
def read_grace_period(engine: EngineDep) -> GracePeriod:
    with engine.connect() as conn:
        return get_grace_period(conn)


@router.put("/settings/grace-period")
def update_grace_period(
    setting: GracePeriod, engine: EngineDep, today: TodayDep
) -> GracePeriod:
    with engine.begin() as conn:
        _GRACE_PERIOD.set(conn, setting, today)
        return get_grace_period(conn)
