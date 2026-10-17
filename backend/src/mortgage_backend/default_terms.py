"""The default Terms copied into every new Mortgage (see GLOSSARY.md)."""

from sqlalchemy import select
from sqlalchemy.dialects.sqlite import insert
from sqlalchemy.engine import Connection

from mortgage_backend.db import config_table
from mortgage_backend.terms import Terms

_CONFIG_KEY_BY_FIELD = {
    "monthly_rate_bps": "default_monthly_rate_bps",
    "interest_mode": "default_interest_mode",
    "part_month_rule": "default_part_month_rule",
}


def get_default_terms(conn: Connection) -> Terms:
    rows = conn.execute(
        select(config_table.c.key, config_table.c.value).where(
            config_table.c.key.in_(_CONFIG_KEY_BY_FIELD.values())
        )
    )
    values = {key: value for key, value in rows}
    return Terms(**{field: values[key] for field, key in _CONFIG_KEY_BY_FIELD.items()})


def set_default_terms(conn: Connection, terms: Terms) -> None:
    for field, key in _CONFIG_KEY_BY_FIELD.items():
        value = str(getattr(terms, field))
        conn.execute(
            insert(config_table)
            .values(key=key, value=value)
            .on_conflict_do_update(index_elements=["key"], set_={"value": value})
        )
