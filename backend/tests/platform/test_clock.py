"""Request-scoped QA clock (platform/clock.py)."""

import pytest
from conftest import TODAY
from fastapi.testclient import TestClient

from mortgage_backend.main import create_app
from mortgage_backend.platform.clock import NowDep, TodayDep


def _app(database_url, monkeypatch_qa=None):
    app = create_app(
        database_url,
        today=lambda: TODAY,
        now=lambda: __import__("datetime").datetime.combine(
            TODAY, __import__("datetime").time(9, 0)
        ),
    )

    @app.get("/_clock")
    def _clock(today: TodayDep, now: NowDep):
        return {"today": today.isoformat(), "now": now.isoformat()}

    return app


@pytest.fixture
def qa_app(database_url, monkeypatch):
    monkeypatch.setattr("mortgage_backend.platform.clock._QA_MODE", True)
    return _app(database_url)


@pytest.fixture
def prod_app(database_url, monkeypatch):
    monkeypatch.setattr("mortgage_backend.platform.clock._QA_MODE", False)
    return _app(database_url)


def test_header_overrides_today_in_qa_mode(qa_app):
    with TestClient(qa_app, base_url="http://localhost") as c:
        r = c.get("/_clock", headers={"X-QA-Clock": "2026-12-25"})
        assert r.status_code == 200
        assert r.json()["today"] == "2026-12-25"


def test_header_ignored_outside_qa_mode(prod_app):
    with TestClient(prod_app, base_url="http://localhost") as c:
        r = c.get("/_clock", headers={"X-QA-Clock": "2026-12-25"})
        assert r.status_code == 200
        assert r.json()["today"] == TODAY.isoformat()


def test_date_only_pins_now_to_noon(qa_app):
    with TestClient(qa_app, base_url="http://localhost") as c:
        r = c.get("/_clock", headers={"X-QA-Clock": "2026-12-25"})
        assert r.json()["now"] == "2026-12-25T12:00:00"


def test_now_header_overrides(qa_app):
    with TestClient(qa_app, base_url="http://localhost") as c:
        r = c.get(
            "/_clock",
            headers={
                "X-QA-Clock": "2026-12-25",
                "X-QA-Clock-Now": "2026-12-25T08:30:00",
            },
        )
        assert r.json()["now"] == "2026-12-25T08:30:00"


def test_bad_header_returns_400(qa_app):
    with TestClient(qa_app, base_url="http://localhost") as c:
        r = c.get("/_clock", headers={"X-QA-Clock": "not-a-date"})
        assert r.status_code == 400


def test_no_header_falls_back_to_process_clock(qa_app):
    with TestClient(qa_app, base_url="http://localhost") as c:
        r = c.get("/_clock")
        assert r.json()["today"] == TODAY.isoformat()
