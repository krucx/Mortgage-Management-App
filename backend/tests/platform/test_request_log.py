"""Every API request is logged as one JSON line (method, path, status, duration in ms); an
unhandled error is logged with its type, message and traceback, then answered with a 500."""

import json
import logging

import pytest
from fastapi import Request, Response
from fastapi.responses import StreamingResponse

LOGGER = "mortgage_backend.platform.request_log"


def records(caplog: pytest.LogCaptureFixture) -> list[dict]:
    return [json.loads(r.getMessage()) for r in caplog.records if r.name == LOGGER]


@pytest.fixture(autouse=True)
def capture(caplog):
    caplog.set_level(logging.INFO, logger=LOGGER)


def test_a_request_logs_its_method_path_status_and_duration(client, caplog):
    assert client.get("/api/health").status_code == 200

    (line,) = records(caplog)
    assert line["event"] == "request"
    assert (line["method"], line["path"], line["status"]) == (
        "GET",
        "/api/health",
        200,
    )
    assert isinstance(line["duration_ms"], (int, float)) and line["duration_ms"] >= 0


def test_the_path_is_logged_without_its_query_string(client, caplog):
    client.get("/api/health?secret=1")

    assert records(caplog)[0]["path"] == "/api/health"


def test_a_refused_request_is_logged_with_its_status(client, caplog):
    assert client.get("/api/no-such-route").status_code == 404

    assert records(caplog)[0]["status"] == 404


def test_an_unhandled_error_logs_its_details_and_answers_500(client, caplog):
    def boom():
        raise ValueError("the ledger exploded")

    client.app.add_api_route("/api/boom", boom)

    response = client.get("/api/boom")

    assert response.status_code == 500
    assert response.json() == {"detail": "Internal Server Error"}
    (line,) = records(caplog)
    assert line["event"] == "unhandled_error"
    assert (line["method"], line["path"], line["status"]) == ("GET", "/api/boom", 500)
    assert line["exception_type"] == "ValueError"
    assert line["exception_message"] == "the ledger exploded"
    assert "Traceback" in line["traceback"] and "boom" in line["traceback"]
    assert line["duration_ms"] >= 0


def test_a_streamed_download_arrives_intact_and_is_logged(client, caplog):
    chunks = [bytes([i]) * 1000 for i in range(5)]

    def download():
        return StreamingResponse(iter(chunks), media_type="application/octet-stream")

    client.app.add_api_route("/api/download", download)

    response = client.get("/api/download")

    assert response.content == b"".join(chunks)
    assert records(caplog)[0]["status"] == 200


def test_a_json_body_and_an_upload_still_reach_their_routes(client, caplog):
    def echo(payload: dict):
        return payload

    async def upload(request: Request):
        return Response(str(len(await request.body())))

    client.app.add_api_route("/api/echo", echo, methods=["POST"])
    client.app.add_api_route("/api/upload", upload, methods=["POST"])

    assert client.post("/api/echo", json={"a": 1}).json() == {"a": 1}
    assert client.post("/api/upload", content=b"\0" * 5000).text == "5000"
    assert [r["status"] for r in records(caplog)] == [200, 200]


def test_the_lines_reach_the_container_output(client, capsys):
    """Without a handler Python drops INFO records, so `docker compose logs` showed no requests."""
    client.get("/api/health")

    out = [json.loads(line) for line in capsys.readouterr().out.splitlines()]
    assert [(r["event"], r["path"], r["status"]) for r in out] == [
        ("request", "/api/health", 200)
    ]


def test_building_the_app_again_does_not_repeat_the_lines(client, capsys):
    from mortgage_backend.platform.request_log import log_to_stdout

    log_to_stdout()
    client.get("/api/health")

    assert len(capsys.readouterr().out.splitlines()) == 1
