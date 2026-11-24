"""The middleware order, pinned by what each layer does to a request: request log >
localhost-only > daily jobs > upload limit > app."""

import json
import logging

import pytest

from mortgage_backend.platform.upload_limit import MAX_BODY_BYTES

LOGGER = "mortgage_backend.platform.request_log"


def records(caplog: pytest.LogCaptureFixture) -> list[dict]:
    return [json.loads(r.getMessage()) for r in caplog.records if r.name == LOGGER]


@pytest.fixture(autouse=True)
def capture(caplog):
    caplog.set_level(logging.INFO, logger=LOGGER)


def test_a_refused_host_runs_no_daily_job_and_is_logged_with_its_refusal(
    client, caplog
):
    runs = client.app.state.daily_run.count

    response = client.get("/api/customers", headers={"host": "evil.example"})

    assert response.status_code == 400
    assert client.app.state.daily_run.count == runs
    (line,) = records(caplog)
    assert (line["event"], line["path"], line["status"]) == (
        "request",
        "/api/customers",
        400,
    )


def test_an_invalid_qa_clock_answers_400_and_is_logged(client, caplog, monkeypatch):
    monkeypatch.setattr("mortgage_backend.platform.clock._QA_MODE", True)

    response = client.get("/api/customers", headers={"X-QA-Clock": "not-a-date"})

    assert response.status_code == 400
    (line,) = records(caplog)
    assert (line["event"], line["path"], line["status"]) == (
        "request",
        "/api/customers",
        400,
    )


def test_an_error_in_the_daily_run_is_logged_and_answered_500(
    client, caplog, monkeypatch
):
    def broken(_day):
        raise RuntimeError("done-marker unreadable")

    monkeypatch.setattr(client.app.state.daily_run, "run_if_due", broken)

    response = client.get("/api/customers")

    assert response.status_code == 500
    assert response.json() == {"detail": "Internal Server Error"}
    (line,) = records(caplog)
    assert (line["event"], line["status"]) == ("unhandled_error", 500)
    assert line["exception_message"] == "done-marker unreadable"


def test_the_daily_jobs_run_before_the_upload_limit_refuses_a_body(client, caplog):
    runs = client.app.state.daily_run.count

    response = client.post(
        "/api/customers", headers={"content-length": str(MAX_BODY_BYTES + 1)}
    )

    assert response.status_code == 413
    assert client.app.state.daily_run.count == runs + 1
    assert records(caplog)[0]["status"] == 413
