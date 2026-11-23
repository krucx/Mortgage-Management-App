"""`GET /api/health`: a probe of the app's own subsystems that reads no Customer or
Mortgage data."""

from sqlalchemy import event, text

from mortgage_backend.platform.db import make_engine


def test_a_healthy_app_reports_every_subsystem(client):
    response = client.get("/api/health")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["database"] == {"connected": True, "error": None}
    assert body["migrations"]["up_to_date"] is True
    assert body["migrations"]["current"] == body["migrations"]["head"]
    assert body["backups"] == {"enabled": False, "running": False}


def test_it_reads_no_domain_table_and_runs_no_daily_job(client):
    tables: list[str] = []

    @event.listens_for(client.app.state.engine, "before_cursor_execute")
    def record(_conn, _cursor, statement, *_rest):
        tables.append(statement)

    runs = client.app.state.daily_run.count
    assert client.get("/api/health").status_code == 200
    assert client.app.state.daily_run.count == runs
    assert not [s for s in tables if "customer" in s or "mortgage" in s]


def test_it_answers_503_when_the_database_cannot_be_reached(client, tmp_path):
    client.app.state.engine = make_engine(f"sqlite:///{tmp_path / 'gone' / 'x.db'}")
    response = client.get("/api/health")
    assert response.status_code == 503
    body = response.json()
    assert body["status"] == "unavailable"
    assert body["database"]["connected"] is False
    assert body["database"]["error"]


def test_it_answers_503_when_the_schema_is_behind(client):
    with client.app.state.engine.begin() as conn:
        conn.execute(text("UPDATE alembic_version SET version_num = '0001'"))
    response = client.get("/api/health")
    assert response.status_code == 503
    body = response.json()
    assert body["migrations"]["up_to_date"] is False
    assert body["migrations"]["current"] == "0001"
