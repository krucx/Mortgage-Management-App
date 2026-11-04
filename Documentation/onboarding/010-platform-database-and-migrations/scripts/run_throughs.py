"""Checks every figure and message chapter 010 shows, against the real platform code.

For the course's editors. Builds the sample book once in a temporary folder (never the
Lender's data), then works on fresh copies of its data folder: each one started by the
real `create_app` (as `serve.py` starts it), with its own Backup folder, so every
Backup, migration and refusal can be watched. Lesson 6's migration 0016 is written into
a temporary copy of the migrations folder, never into the repo.

    cd backend && uv run python ../Documentation/onboarding/010-platform-database-and-migrations/scripts/run_throughs.py

Each section is headed with the lesson that quotes it (L1–L6, 99).
"""

import shutil
import sqlite3
import sys
import tempfile
from datetime import date, datetime, time
from pathlib import Path

from fastapi.testclient import TestClient
from sqlalchemy import Column, String, select
from sqlalchemy.dialects import sqlite as sqlite_dialect

REPO = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(REPO / "docs" / "sample-book"))

import book  # noqa: E402

from mortgage_backend.collateral import collateral  # noqa: E402
from mortgage_backend.main import create_app  # noqa: E402
from mortgage_backend.payments.cash_limit import get_cash_limit  # noqa: E402
from mortgage_backend.people import customers  # noqa: E402
from mortgage_backend.platform import db  # noqa: E402
from mortgage_backend.platform.db import (  # noqa: E402
    customer_table,
    get_config,
    make_engine,
    migrate,
)

THE_DAY = book.THE_DAY
BACKUP_KEYS = ["backup_last_at", "backup_last_file", "backup_last_error", "backup_keep"]


def sql(path: Path, query: str) -> list[tuple]:
    with sqlite3.connect(path) as conn:
        rows = conn.execute(query).fetchall()
    print("     sqlite>", " ".join(query.split()))
    for row in rows:
        print("      ", " | ".join("NULL" if v is None else str(v) for v in row))
    return rows


class Copy:
    """A fresh copy of the built book's data folder, with its own (empty) Backup folder."""

    def __init__(self, built: Path, name: str) -> None:
        self.folder = built.parent / name
        shutil.copytree(built, self.folder / "data")
        self.db = self.folder / "data" / "mortgage.db"
        self.url = f"sqlite:///{self.db}"
        self.backups = self.folder / "backups"

    def app(self, day: date = THE_DAY, backups: bool = True, **kw):
        return create_app(
            self.url,
            today=lambda: day,
            now=lambda: datetime.combine(day, time(11, 0)),
            backup_dir=self.backups if backups else None,
            **kw,
        )

    def backup_files(self) -> list[str]:
        return sorted(p.name for p in self.backups.glob("*")) if self.backups.exists() else []

    def config(self, *keys: str) -> dict:
        with make_engine(self.url).connect() as conn:
            return get_config(conn, keys)

    def revision(self) -> str:
        with sqlite3.connect(self.db) as conn:
            return conn.execute("SELECT version_num FROM alembic_version").fetchone()[0]


def finished(client: TestClient) -> None:
    client.app.state.backups.wait()


def main() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        folder = Path(tmp) / "book"
        book.write(folder)
        report(folder / "data")


def report(built: Path) -> None:
    # ------------------------------------------------------------ lesson 1
    print("\n== L1. Starting the app as serve.py does")
    c = Copy(built, "l1")
    print("   the built book's config, before any start:")
    print("    ", c.config("last_daily_run", *BACKUP_KEYS))
    c.backups.mkdir()
    (c.backups / ".mortgage-backup-2026-10-18-2200.zip.partial").write_bytes(b"PK")
    (c.db.parent / ".backup-work").mkdir()
    print("   leftovers before start:", c.backup_files(), "+ data/.backup-work")
    app = c.app()
    print("   app.state:", sorted(k for k in vars(app.state)["_state"]))
    with TestClient(app) as client:
        finished(client)
        print("   right after start (no request yet):")
        print("     backups:", c.backup_files())
        print("     .backup-work exists:", (c.db.parent / ".backup-work").exists())
        print("     revision:", c.revision())
        print("     daily_run.count:", client.app.state.daily_run.count)
        print("     config:", c.config("last_daily_run", "backup_last_at", "backup_last_file"))
        r = client.get("/api/backups")
        print("   GET /api/backups ->", r.status_code, r.json())
    print("   started without a backup_dir:")
    with TestClient(Copy(built, "l1-nobackups").app(backups=False)) as client:
        r = client.get("/api/backups")
        print("     GET /api/backups ->", r.status_code, r.json())
        r = client.post("/api/backups")
        print("     POST /api/backups ->", r.status_code, r.json())
        print("     GET /api/update ->", client.get("/api/update").json())
    print("   with and without a screens_dir:")
    dist = Path(tmp_dist := tempfile.mkdtemp()) / "dist"
    dist.mkdir()
    (dist / "index.html").write_text("<p>screens</p>")
    for screens in (None, dist):
        with TestClient(Copy(built, f"l1-screens-{screens is None}").app(backups=False, screens_dir=screens)) as client:
            for path in ("/customers", "/api/customers?page=1", "/api/nothing-here"):
                r = client.get(path)
                print(f"     screens_dir={'dist' if screens else None} GET {path} -> {r.status_code}"
                      f" {r.headers.get('content-type')}")
    shutil.rmtree(tmp_dist)

    # ------------------------------------------------------------ lesson 2
    print("\n== L2. Today, now and the daily run")
    c = Copy(built, "l2")
    with TestClient(c.app()) as client:
        finished(client)
        print("   served on 19 Oct; after start:", c.backup_files(),
              "count", client.app.state.daily_run.count)
        client.get("/api/customers")
        finished(client)
        print("   after the first /api/ request: count", client.app.state.daily_run.count,
              c.config("last_daily_run"), c.backup_files())
    print("   the same copy served on 20 Oct:")
    with TestClient(c.app(day=date(2026, 10, 20))) as client:
        finished(client)
        print("     after start: backups", c.backup_files(), "count", client.app.state.daily_run.count)
        client.get("/docs")
        client.get("/openapi.json")
        print("     after GET /docs and /openapi.json: count", client.app.state.daily_run.count,
              c.config("last_daily_run"))
        sql(c.db, "SELECT count(*) FROM notice WHERE created_on = '2026-10-20'")
        client.get("/api/settings/default-terms")
        finished(client)
        print("     after the first /api/ request: count", client.app.state.daily_run.count,
              c.config("last_daily_run"), "backups", c.backup_files())
        sql(c.db, "SELECT id, customer_id, accrues_on, created_on, status FROM notice WHERE status != 'sent'")
        client.get("/api/customers")
        print("     after a second request: count", client.app.state.daily_run.count)
    print("   restarted on 20 Oct:")
    with TestClient(c.app(day=date(2026, 10, 20))) as client:
        client.get("/api/customers")
        finished(client)
        print("     after a request: count", client.app.state.daily_run.count, "backups", c.backup_files())
    print("   served on 26 Oct (7 days after the 19 Oct Backup), started on 25 Oct first:")
    with TestClient(c.app(day=date(2026, 10, 25))) as client:
        client.get("/api/customers")
        finished(client)
        print("     25 Oct: count", client.app.state.daily_run.count, "backups", c.backup_files())
    with TestClient(c.app(day=date(2026, 10, 26))) as client:
        finished(client)
        print("     26 Oct after start:", c.backup_files())
        client.get("/api/customers")
        finished(client)
        print("     26 Oct after a request: count", client.app.state.daily_run.count, c.backup_files())
    print("   a failing job doesn't stop the next:")
    c2 = Copy(built, "l2-fail")
    with TestClient(c2.app(day=date(2026, 10, 20), backups=False)) as client:
        ran = []

        def broken(day):
            raise ValueError("boom")

        client.app.state.daily_run.jobs = [broken, lambda day: ran.append(day)]
        r = client.get("/api/customers")
        print("     request ->", r.status_code, "second job ran on", ran)

    # ------------------------------------------------------------ lesson 3
    print("\n== L3. Settings in the config table")
    c = Copy(built, "l3")
    sql(c.db, "SELECT key, CASE WHEN length(value) > 30 THEN substr(value, 1, 22) || '…' ELSE value END"
              " FROM config ORDER BY rowid")
    with TestClient(c.app()) as client:
        finished(client)
        print("   after serving: backup keys", c.config(*BACKUP_KEYS))
        for path in ("/settings/default-terms", "/settings/call-list", "/settings/backups",
                     "/settings/cash-limit", "/backups"):
            print(f"   GET {path}:", client.get("/api" + path).json())
        s = client.get("/api/settings/messages").json()
        print("   messages: days", s["notice_days_before"], "approve_first", s["notice_approve_first"])
        sql(c.db, "SELECT id, status, approved FROM notice WHERE status != 'sent'")
        r = client.put("/api/settings/messages", json={**s, "notice_approve_first": False})
        print("   PUT approve_first false ->", r.status_code)
        sql(c.db, "SELECT key, value FROM config WHERE key = 'message_notice_approve_first'")
        sql(c.db, "SELECT id, status, approved FROM notice WHERE status != 'sent'")
        r = client.put("/api/settings/messages", json={**s, "notice_days_before": 7})
        print("   PUT days 7 (approve first back on) ->", r.status_code)
        sql(c.db, "SELECT id, customer_id, accrues_on, status FROM notice WHERE status != 'sent'")
        r = client.put("/api/settings/messages", json={**s, "notice_days_before": 0})
        print("   PUT days 0 ->", r.status_code, r.json()["detail"][0]["msg"])
        r = client.put("/api/settings/call-list", json={"months_unpaid": 3, "loan_to_value_pct": 85})
        print("   PUT call-list same values ->", r.status_code, r.json())
        # Cash limit: cleared vs never set
        print("   cash limit, never set:", c.config("cash_limit"), client.get("/api/settings/cash-limit").json())
        client.put("/api/settings/cash-limit", json={"cash_limit": None})
        print("   cash limit, PUT null:", c.config("cash_limit"), client.get("/api/settings/cash-limit").json())
    # None forgets: a Gold Rate group
    with make_engine(c.url).begin() as conn:
        group = collateral._GOLD_RATES[22]
        print("   22K group keys:", group.keys)
        print("   22K before:", group.get(conn))
        group.set(conn, group.model(rate_per_gram=None, updated_on=None), THE_DAY)
        print("   22K after set(None, None):", group.get(conn), get_config(conn, group.keys.values()))
        print("   cash limit if its key were deleted:", end=" ")
        conn.exec_driver_sql("DELETE FROM config WHERE key = 'cash_limit'")
        print(get_cash_limit(conn))

    # ------------------------------------------------------------ lesson 4
    print("\n== L4. Tables, the engine and pages")
    print("   Tables:", list(db.metadata.tables))
    c = Copy(built, "l4")
    with TestClient(c.app(backups=False)) as client:
        for params in ({}, {"descending": "true"}, {"sort": "referrer"},
                       {"sort": "referrer", "descending": "true"}, {"page": 2}):
            p = client.get("/api/customers", params=params).json()
            print(f"   GET /api/customers {params}: total {p['total']} page {p['page']} size {p['page_size']}:",
                  [(i["id"], i["name"]) for i in p["items"]])
        q = select(customer_table).where(True)
        order = customers._SORTING.order("name", False)
        stmt = q.order_by(*order).limit(20).offset(0)
        print("   SQL for name ascending, page 1:")
        print("    ", str(stmt.compile(dialect=sqlite_dialect.dialect(), compile_kwargs={"literal_binds": True})).replace("\n", " "))
        print("   order() desc:", [str(o) for o in customers._SORTING.order("name", True)])
        # a second Meera: ties
        r = client.post("/api/customers", json={
            "name": "Meera Sharma", "address": "Pune", "phone_1": "+91 90000 11111"})
        print("   POST second Meera ->", r.status_code, r.json().get("id") if r.status_code < 300 else r.json())
        for desc in (False, True):
            p = client.get("/api/customers", params={"descending": str(desc).lower()}).json()
            print(f"   desc={desc}:", [(i["id"], i["name"]) for i in p["items"]])
        # Call List: rows_page
        p = client.get("/api/call-list").json()
        print("   GET /api/call-list: total", p["total"], "page_size", p["page_size"], "mortgages", p["mortgages"],
              [g["customer"]["name"] for g in p["items"]])
        # a refused change leaves no rows
        before = sql(c.db, "SELECT count(*) FROM payment")
        r = client.post("/api/payments", json={"customer_id": 1, "paid_on": "2026-10-19", "method": "upi", "amount": 90_000_00,
                                                "allocations": [{"mortgage_id": 2, "amount": 90_000_00}]})
        print("   overpayment ->", r.status_code, r.json().get("detail"))
        sql(c.db, "SELECT count(*) FROM payment")
    # foreign keys
    print("   foreign keys:")
    with sqlite3.connect(c.db) as raw:
        print("     PRAGMA foreign_keys (plain sqlite3):", raw.execute("PRAGMA foreign_keys").fetchone())
        try:
            raw.execute("INSERT INTO call_note (mortgage_id, called_on, note) VALUES (999, '2026-10-19', 'x')")
            print("     plain sqlite3 insert with mortgage_id 999: accepted")
        except sqlite3.IntegrityError as e:
            print("     plain sqlite3:", e)
        raw.rollback()
    try:
        with make_engine(c.url).begin() as conn:
            print("     PRAGMA via make_engine:", conn.exec_driver_sql("PRAGMA foreign_keys").fetchone())
            conn.exec_driver_sql("INSERT INTO call_note (mortgage_id, called_on, note) VALUES (999, '2026-10-19', 'x')")
    except Exception as e:
        print("     make_engine:", type(e).__name__, str(e).splitlines()[0])
    sql(c.db, "SELECT amount_lent, monthly_rate_bps FROM mortgage WHERE id = 2")

    # ------------------------------------------------------------ lesson 5
    print("\n== L5. How the app migrates on every start")
    c = Copy(built, "l5")
    print("   revision:", c.revision())
    sql(c.db, "SELECT * FROM alembic_version")
    for n in (1, 2):
        with TestClient(c.app()) as client:
            finished(client)
        print(f"   start {n}: revision {c.revision()} backups {c.backup_files()}")
    print("   a database from a newer version:")
    c = Copy(built, "l5-newer")
    with sqlite3.connect(c.db) as conn:
        conn.execute("UPDATE alembic_version SET version_num = '0016'")
    for n in (1, 2, 3):
        try:
            with TestClient(c.app()):
                pass
        except RuntimeError as e:
            print(f"   start {n}: RuntimeError: {e}")
    print("     backups:", c.backup_files(), "revision", c.revision())
    print("   a database from the version before (downgraded to 0014):")
    c = Copy(built, "l5-older")
    from alembic import command
    from alembic.config import Config
    cfg = Config()
    cfg.set_main_option("script_location", str(db.MIGRATIONS_DIR))
    cfg.set_main_option("sqlalchemy.url", c.url)
    command.downgrade(cfg, "0014")
    print("     revision", c.revision(), "customer columns:",
          [r[1] for r in sqlite3.connect(c.db).execute("PRAGMA table_info(customer)")])
    # failing before_update: nothing migrated
    def refuse():
        raise OSError("the backup folder is full")
    try:
        migrate(c.url, before_update=refuse)
    except OSError as e:
        print("     migrate with a failing before_update:", e, "→ revision", c.revision())
    with TestClient(c.app()) as client:
        finished(client)
    print("     started: revision", c.revision(), "backups", c.backup_files())
    print("   a fresh install:")
    fresh = Path(built.parent / "fresh")
    fresh_url = f"sqlite:///{fresh / 'data' / 'mortgage.db'}"
    with TestClient(create_app(fresh_url, today=lambda: THE_DAY,
                               now=lambda: datetime.combine(THE_DAY, time(11, 0)),
                               backup_dir=fresh / "backups")) as client:
        finished(client)
    print("     backups:", sorted(p.name for p in (fresh / "backups").glob("*")))
    print("     revision:", sqlite3.connect(fresh / "data" / "mortgage.db").execute(
        "SELECT version_num FROM alembic_version").fetchone()[0])

    # ------------------------------------------------------------ lesson 6
    print("\n== L6. Adding migration 0016 (in a temporary migrations folder)")
    migrations = built.parent / "migrations"
    shutil.copytree(db.MIGRATIONS_DIR, migrations, ignore=shutil.ignore_patterns("__pycache__"))
    (migrations / "versions" / "0016_customer_nickname.py").write_text(NICKNAME_MIGRATION)
    db.MIGRATIONS_DIR = migrations
    customer_table.append_column(Column("nickname", String))  # the db.py mirror
    c = Copy(built, "l6")
    for n in (1, 2):
        with TestClient(c.app()) as client:
            finished(client)
            if n == 1:
                r = client.get("/api/customers/1")
                print("     GET /api/customers/1 ->", r.status_code)
        print(f"   start {n}: revision {c.revision()} backups {c.backup_files()}")
    sql(c.db, "SELECT name, type, \"notnull\", dflt_value FROM pragma_table_info('customer') WHERE name IN ('pan_photo', 'nickname')")
    sql(c.db, "SELECT id, name, nickname FROM customer WHERE id <= 2")
    print("   NOT NULL without a server default, on a database with Customers:")
    (migrations / "versions" / "0016_customer_nickname.py").write_text(
        NICKNAME_MIGRATION.replace("nullable=True", "nullable=False"))
    c = Copy(built, "l6-notnull")
    try:
        with TestClient(c.app()):
            pass
    except Exception as e:
        print("    ", type(e).__name__, str(e).splitlines()[0])
    print("     revision", c.revision(), "backups", c.backup_files())


NICKNAME_MIGRATION = '''"""A Customer's optional nickname: empty for the Customers made before.

Revision ID: 0016
Revises: 0015
"""

import sqlalchemy as sa
from alembic import op

revision = "0016"
down_revision = "0015"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("customer") as batch:
        batch.add_column(sa.Column("nickname", sa.String(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("customer") as batch:
        batch.drop_column("nickname")
'''


if __name__ == "__main__":
    main()
