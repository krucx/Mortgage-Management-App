"""One JSON log line per request, for any server log collector: its method, path (no query
string, which may carry a name or phone number), status and duration in milliseconds. An
error nothing handled is logged with its type, message and traceback, then answered 500.

Pure ASGI, so bodies and responses pass through chunk by chunk: an upload or a download is
never buffered or altered, and only the status line is looked at."""

import json
import logging
import sys
import time
import traceback

from fastapi.responses import JSONResponse
from starlette.types import ASGIApp, Message, Receive, Scope, Send

log = logging.getLogger(__name__)


class _Stdout(logging.Handler):
    """Writes to whatever sys.stdout is when a line is logged."""

    def emit(self, record: logging.LogRecord) -> None:
        print(self.format(record), file=sys.stdout, flush=True)


def log_to_stdout() -> None:
    """Python drops INFO records when nothing configures logging, and uvicorn configures only
    its own loggers. Send ours to stdout, where `docker compose logs` reads it. Safe to call
    again."""
    if not any(isinstance(h, _Stdout) for h in log.handlers):
        log.addHandler(_Stdout())
    log.setLevel(logging.INFO)


class RequestLog:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        started = time.perf_counter()
        status = 0  # until the response starts

        async def watching(message: Message) -> None:
            nonlocal status
            if message["type"] == "http.response.start":
                status = message["status"]
            await send(message)

        def line(event: str, **more: object) -> str:
            duration = round((time.perf_counter() - started) * 1000, 2)
            return json.dumps(
                {
                    "event": event,
                    "method": scope["method"],
                    "path": scope["path"],
                    "status": status,
                    "duration_ms": duration,
                    **more,
                }
            )

        try:
            await self.app(scope, receive, watching)
        except Exception as error:
            answered = status != 0  # a response already started cannot become a 500
            if not answered:
                status = 500
            log.error(
                line(
                    "unhandled_error",
                    exception_type=type(error).__name__,
                    exception_message=str(error),
                    traceback="".join(traceback.format_exception(error)),
                )
            )
            if answered:
                raise
            await JSONResponse({"detail": "Internal Server Error"}, 500)(
                scope, receive, send
            )
            return
        log.info(line("request"))
