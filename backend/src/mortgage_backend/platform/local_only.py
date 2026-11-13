"""The app has no sign-in; it relies on being reached only from this PC. Other websites the
Lender visits can still aim a browser at it, so the backend answers only requests addressed
to it as localhost / 127.0.0.1, and refuses a state-changing one made from another site."""

from urllib.parse import urlsplit

from fastapi.responses import JSONResponse
from starlette.types import ASGIApp, Receive, Scope, Send

LOCAL_HOSTS = {"localhost", "127.0.0.1", "[::1]"}
SAFE_METHODS = {"GET", "HEAD"}


def host_name(host: str) -> str:
    """The host without its port: `localhost:8080` is `localhost`, `[::1]:80` is `[::1]`."""
    return host.rsplit(":", 1)[0] if host.rpartition(":")[2].isdigit() else host


class LocalOnly:
    """ASGI middleware: a request whose Host is not this PC is refused (400), which stops a
    page that rebinds its domain to 127.0.0.1 from reading the API; a non-GET/HEAD request
    whose Origin is another site than the one addressed is refused (403), multipart uploads
    included. A request without an Origin (curl, health checks) passes."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        headers = dict(scope["headers"])
        host = headers.get(b"host", b"").decode("latin-1").lower()
        if host_name(host) not in LOCAL_HOSTS:
            await JSONResponse({"detail": "Unknown host."}, 400)(scope, receive, send)
            return
        origin = headers.get(b"origin")
        if (
            origin is not None
            and scope["method"] not in SAFE_METHODS
            and urlsplit(origin.decode("latin-1")).netloc.lower() != host
        ):
            await JSONResponse({"detail": "Requests from other sites are refused."}, 403)(
                scope, receive, send
            )
            return
        await self.app(scope, receive, send)
