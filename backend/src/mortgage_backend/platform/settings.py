"""Values kept in the config table, a group at a time: the Lender's settings, and the
little the app records for itself (the last Backup, the last daily run).

A group is declared once: a model, the config key of each field (usually a prefix)
and what reacts when it is set. `get` reads it back, missing keys taking the model's
defaults; `set` stores it as text the way the app always has (true/false, ISO dates,
enum values), forgets the fields set to None, then runs the reactions.
"""

from collections.abc import Callable, Mapping, Sequence
from datetime import date
from typing import Any

from pydantic import BaseModel
from sqlalchemy import delete
from sqlalchemy.engine import Connection

from mortgage_backend.platform.db import config_table, get_config, set_config

# Reacts to a group being set, on the same connection; `today` is the business date.
AfterSet = Callable[[Connection, date], None]


class ConfigGroup[M: BaseModel]:
    def __init__(
        self,
        model: type[M],
        keys: Mapping[str, str],
        after_set: Sequence[AfterSet] = (),
    ) -> None:
        self.model = model
        self.keys = dict(keys)  # config key by field
        self.after_set = list(after_set)

    @classmethod
    def prefixed(
        cls, prefix: str, model: type[M], after_set: Sequence[AfterSet] = ()
    ) -> "ConfigGroup[M]":
        """A group storing each field under `prefix` + its name."""
        keys = {field: prefix + field for field in model.model_fields}
        return cls(model, keys, after_set)

    def get(self, conn: Connection) -> M:
        stored = get_config(conn, self.keys.values())
        return self.model.model_validate(
            {field: stored[key] for field, key in self.keys.items() if key in stored}
        )

    def set(self, conn: Connection, value: M, today: date) -> None:
        for field, stored in value.model_dump(mode="json").items():
            key = self.keys[field]
            if stored is None:
                conn.execute(delete(config_table).where(config_table.c.key == key))
            else:
                set_config(conn, key, _as_text(stored))
        for react in self.after_set:
            react(conn, today)


def _as_text(value: Any) -> str:
    return ("true" if value else "false") if isinstance(value, bool) else str(value)
