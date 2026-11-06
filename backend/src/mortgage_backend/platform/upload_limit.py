"""The largest request body the backend takes: 20 MB, room for a phone photo (often several
MB). It refuses a larger one before reading or storing it, in Docker or without it."""

from fastapi import HTTPException, status
from fastapi.responses import JSONResponse
from starlette.types import ASGIApp, Message, Receive, Scope, Send

MAX_BODY_BYTES = 20 * 1024 * 1024
TOO_LARGE_MESSAGE = "The file is too large (over 20 MB)."


class UploadLimit:
    """ASGI middleware: a body whose Content-Length is over MAX_BODY_BYTES is refused at
    once (413); one sent without its length is counted as it arrives, and refused once it
    passes the limit."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        length = dict(scope["headers"]).get(b"content-length")
        if length is not None and length.isdigit() and int(length) > MAX_BODY_BYTES:
            await JSONResponse({"detail": TOO_LARGE_MESSAGE}, 413)(scope, receive, send)
            return
        received = 0

        async def counted() -> Message:
            nonlocal received
            message = await receive()
            received += len(message.get("body", b""))
            if received > MAX_BODY_BYTES:
                # Raised while the route reads its body, which FastAPI answers as it is.
                raise HTTPException(status.HTTP_413_CONTENT_TOO_LARGE, TOO_LARGE_MESSAGE)
            return message

        await self.app(scope, counted, send)
