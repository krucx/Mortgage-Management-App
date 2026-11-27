"""The HTTP boundary stays put: domain code refuses with a `Refusal`, and only the HTTP
layer speaks HTTP (#606, architecture review pass 8).

`HTTPException` is named (raised, made, subclassed, passed on) only directly inside
- a route handler: a function decorated with a route of a router or app made in, or
  handed to, the same module (`@router.get(...)`, `@app.api_route(...)`), or
- a FastAPI dependency: a function the same module passes to `Depends(...)`; it is part
  of reading the request, as a route handler is, or
- a function in `ALLOWED_SITES`, by qualified name, each with its reason.
An `except HTTPException` is allowed in those places and in `HTTP_LAYER` modules too.

Domain modules (any module that registers no route and is not in `HTTP_LAYER`) import
nothing from FastAPI or Starlette. The removed helper that built an `HTTPException` for a
refusal (`unprocessable`) is not defined, imported or called again. Each violation names
its file and line.
"""

import ast
import textwrap
from pathlib import Path

SRC = Path(__file__).resolve().parents[2] / "src"

# Modules that register no route but are the HTTP layer: the app, its middleware, and
# what FastAPI reads from the request (dependencies, query parameters).
HTTP_LAYER = {
    "mortgage_backend/main.py",
    "mortgage_backend/openapi.py",
    "mortgage_backend/platform/clock.py",
    "mortgage_backend/platform/db.py",
    "mortgage_backend/platform/local_only.py",
    "mortgage_backend/platform/paging.py",
    "mortgage_backend/platform/request_log.py",
    "mortgage_backend/platform/upload_limit.py",
}

# (module, qualified function name) -> why that function may name HTTPException.
ALLOWED_SITES = {
    ("mortgage_backend/platform/upload_limit.py", "UploadLimit.__call__.counted"): (
        "ASGI middleware: a body that passes the limit while the route reads it is "
        "answered 413 by FastAPI's own HTTPException handler"
    ),
}

REMOVED_HELPERS = {"unprocessable"}

ROUTE_DECORATORS = {
    "get",
    "post",
    "put",
    "patch",
    "delete",
    "head",
    "options",
    "api_route",
    "route",
}
ROUTERS = {"APIRouter", "FastAPI"}
HTTP_PACKAGES = ("fastapi", "starlette")
HTTP_EXCEPTION_MODULES = {"fastapi", "fastapi.exceptions", "starlette.exceptions"}

Function = ast.FunctionDef | ast.AsyncFunctionDef


def _last_name(node: ast.expr | None) -> str | None:
    """`APIRouter` for `APIRouter` and `fastapi.APIRouter`."""
    if isinstance(node, ast.Name):
        return node.id
    if isinstance(node, ast.Attribute):
        return node.attr
    return None


def _routers(tree: ast.Module) -> set[str]:
    """Names this module binds to an APIRouter or FastAPI app: made here
    (`router = APIRouter()`) or handed in (`app: FastAPI`)."""
    names = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Assign) and isinstance(node.value, ast.Call):
            if _last_name(node.value.func) in ROUTERS:
                names |= {t.id for t in node.targets if isinstance(t, ast.Name)}
        elif isinstance(node, ast.arg) and _last_name(node.annotation) in ROUTERS:
            names.add(node.arg)
    return names


def _dependencies(tree: ast.Module) -> set[str]:
    """Functions defined in this module that it passes to `Depends(...)`."""
    defined = {n.name for n in ast.walk(tree) if isinstance(n, Function)}
    return {
        node.args[0].id
        for node in ast.walk(tree)
        if isinstance(node, ast.Call)
        and _last_name(node.func) == "Depends"
        and node.args
        and isinstance(node.args[0], ast.Name)
        and node.args[0].id in defined
    }


def _http_exception_names(tree: ast.Module) -> tuple[set[str], set[str]]:
    """How this module can name HTTPException: bare names (imported as
    `HTTPException` from anywhere, re-exports included, or an alias of it) and the
    modules it is reached through (`fastapi.HTTPException`, `exceptions.HTTPException`)."""
    names, modules = set(), set()
    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom):
            for alias in node.names:
                bound = alias.asname or alias.name
                if alias.name == "HTTPException":
                    names.add(bound)
                elif f"{node.module}.{alias.name}" in HTTP_EXCEPTION_MODULES:
                    modules.add(bound)
        elif isinstance(node, ast.Import):
            for alias in node.names:
                if alias.name in HTTP_EXCEPTION_MODULES:
                    modules.add(alias.asname or alias.name)
    return names, modules


def _imports_http(tree: ast.Module) -> list[ast.stmt]:
    found: list[ast.stmt] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom) and node.module:
            if node.module.split(".")[0] in HTTP_PACKAGES:
                found.append(node)
        elif isinstance(node, ast.Import):
            if any(a.name.split(".")[0] in HTTP_PACKAGES for a in node.names):
                found.append(node)
    return found


class _ModuleScan(ast.NodeVisitor):
    """One module's references to HTTPException, each with its innermost function's
    qualified name and whether it is an `except` clause; uses of a removed helper; and
    how many route handlers it registers."""

    def __init__(self, tree: ast.Module) -> None:
        self.names, self.modules = _http_exception_names(tree)
        self.routers = _routers(tree)
        self.dependencies = _dependencies(tree)
        self.scope: list[str] = []
        self.allowed: list[bool] = []  # per enclosing scope: a handler or dependency?
        # (line, qualified function name or None, caught, allowed)
        self.references: list[tuple[int, str | None, bool, bool]] = []
        self.removed: list[tuple[int, str]] = []
        self.routes = 0
        self.visit(tree)

    def _is_route_handler(self, function: Function) -> bool:
        return any(
            isinstance(d, ast.Call)
            and isinstance(d.func, ast.Attribute)
            and d.func.attr in ROUTE_DECORATORS
            and isinstance(d.func.value, ast.Name)
            and d.func.value.id in self.routers
            for d in function.decorator_list
        )

    def _function(self, node: Function) -> None:
        if node.name in REMOVED_HELPERS:
            self.removed.append((node.lineno, node.name))
        handler = self._is_route_handler(node)
        self.routes += handler
        for decorator in node.decorator_list:
            self.visit(decorator)
        self.scope.append(node.name)
        self.allowed.append(handler or node.name in self.dependencies)
        for child in [node.args, *node.body]:
            self.visit(child)
        if node.returns:
            self.visit(node.returns)
        self.allowed.pop()
        self.scope.pop()

    visit_FunctionDef = _function
    visit_AsyncFunctionDef = _function

    def visit_ClassDef(self, node: ast.ClassDef) -> None:
        for child in [*node.bases, *node.keywords, *node.decorator_list]:
            self.visit(child)
        self.scope.append(node.name)
        self.allowed.append(False)
        for child in node.body:
            self.visit(child)
        self.allowed.pop()
        self.scope.pop()

    def _reference(self, node: ast.expr, caught: bool = False) -> None:
        function = ".".join(self.scope) if self.scope else None
        allowed = bool(self.allowed) and self.allowed[-1]
        self.references.append((node.lineno, function, caught, allowed))

    def _names_http_exception(self, node: ast.expr) -> bool:
        if isinstance(node, ast.Name):
            return node.id in self.names
        if isinstance(node, ast.Attribute) and node.attr == "HTTPException":
            return ast.unparse(node.value) in self.modules
        return False

    def visit_Name(self, node: ast.Name) -> None:
        if self._names_http_exception(node):
            self._reference(node)

    def visit_Attribute(self, node: ast.Attribute) -> None:
        if self._names_http_exception(node):
            self._reference(node)
        else:
            self.generic_visit(node)

    def visit_ExceptHandler(self, node: ast.ExceptHandler) -> None:
        types = node.type.elts if isinstance(node.type, ast.Tuple) else [node.type]
        for caught in types:
            if caught is not None and self._names_http_exception(caught):
                self._reference(caught, caught=True)
            elif caught is not None:
                self.visit(caught)
        for child in node.body:
            self.visit(child)

    def visit_Call(self, node: ast.Call) -> None:
        name = _last_name(node.func)
        if name in REMOVED_HELPERS:
            self.removed.append((node.lineno, name))
        self.generic_visit(node)

    def visit_ImportFrom(self, node: ast.ImportFrom) -> None:
        for alias in node.names:
            if alias.name in REMOVED_HELPERS:
                self.removed.append((node.lineno, alias.name))


def http_boundary_violations(sources: dict[str, str]) -> list[str]:
    """`sources` maps a module path under src/ to its code; one line per violation,
    `src/<path>:<line>: <what>`, in file and line order."""
    violations: list[tuple[str, int, str]] = []
    for path, code in sorted(sources.items()):
        tree = ast.parse(code, path)
        scan = _ModuleScan(tree)
        for line, function, caught, allowed in scan.references:
            if allowed or (path, function) in ALLOWED_SITES:
                continue
            if caught and path in HTTP_LAYER:
                continue
            where = f"in {function}()" if function else "at module level"
            violations.append(
                (
                    path,
                    line,
                    f"HTTPException {'caught' if caught else 'used'} {where}, not "
                    "directly in a route handler; raise a Refusal instead",
                )
            )
        for line, name in scan.removed:
            violations.append(
                (path, line, f"{name}() was removed (#606); raise a Refusal instead")
            )
        if not scan.routes and path not in HTTP_LAYER:
            for node in _imports_http(tree):
                violations.append(
                    (
                        path,
                        node.lineno,
                        "domain module imports FastAPI/Starlette; raise a Refusal, "
                        "or add the module to HTTP_LAYER if it is part of the request",
                    )
                )
    return [f"src/{path}:{line}: {what}" for path, line, what in sorted(violations)]


def _backend_sources() -> dict[str, str]:
    return {
        file.relative_to(SRC).as_posix(): file.read_text(encoding="utf-8")
        for file in sorted(SRC.rglob("*.py"))
    }


def test_the_backend_keeps_http_at_its_boundary() -> None:
    assert http_boundary_violations(_backend_sources()) == []


def test_every_allowance_still_names_a_real_module_or_site() -> None:
    sources = _backend_sources()
    assert HTTP_LAYER <= sources.keys()
    for path, function in ALLOWED_SITES:
        scan = _ModuleScan(ast.parse(sources[path]))
        used_in = {name for _, name, _, _ in scan.references}
        assert function in used_in, f"{path}: {function}() no longer needs allowing"


# The checker itself, on small modules.


def _check(**modules: str) -> list[str]:
    return http_boundary_violations(
        {
            f"mortgage_backend/{name.replace('__', '/')}.py": textwrap.dedent(code)
            for name, code in modules.items()
        }
    )


def test_a_route_handler_may_raise_an_http_exception() -> None:
    assert (
        _check(
            routes="""
            from fastapi import APIRouter, HTTPException
            router = APIRouter()

            @router.get("/thing")
            def read_thing() -> None:
                raise HTTPException(404, "Thing not found")
            """
        )
        == []
    )


def test_an_app_route_and_a_dependency_may_raise_one() -> None:
    assert (
        _check(
            screens="""
            from fastapi import FastAPI, HTTPException

            def serve(app: FastAPI) -> None:
                @app.api_route("/{path:path}", methods=["GET"])
                def screen(path: str) -> None:
                    raise HTTPException(404, "Not Found")
            """,
            platform__clock="""
            from typing import Annotated
            from fastapi import Depends, HTTPException

            def get_today() -> None:
                raise HTTPException(400, "bad X-QA-Clock")

            TodayDep = Annotated[None, Depends(get_today)]
            """,
        )
        == []
    )


def test_a_helper_raising_one_is_named_by_file_and_line() -> None:
    assert _check(
        lending__closing="""
        from fastapi import APIRouter, HTTPException
        router = APIRouter()

        def check(amount: int) -> None:
            if amount < 0:
                raise HTTPException(422, "negative")

        @router.post("/close")
        def close(amount: int) -> None:
            check(amount)
        """
    ) == [
        "src/mortgage_backend/lending/closing.py:7: HTTPException used in check(), "
        "not directly in a route handler; raise a Refusal instead"
    ]


def test_a_function_nested_in_a_route_handler_is_not_the_handler() -> None:
    assert _check(
        routes="""
        from fastapi import APIRouter, HTTPException
        router = APIRouter()

        @router.post("/thing")
        def change_thing() -> None:
            def refuse() -> None:
                raise HTTPException(422, "no")
            refuse()
        """
    ) == [
        "src/mortgage_backend/routes.py:8: HTTPException used in "
        "change_thing.refuse(), "
        "not directly in a route handler; raise a Refusal instead"
    ]


def test_the_removed_helper_is_caught_if_it_comes_back() -> None:
    assert _check(
        platform__errors="""
        from fastapi import HTTPException, status

        def unprocessable(message: str) -> HTTPException:
            return HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, message)
        """
    ) == [
        "src/mortgage_backend/platform/errors.py:2: domain module imports "
        "FastAPI/Starlette; raise a Refusal, or add the module to HTTP_LAYER if it is "
        "part of the request",
        "src/mortgage_backend/platform/errors.py:4: HTTPException used in "
        "unprocessable(), not directly in a route handler; raise a Refusal instead",
        "src/mortgage_backend/platform/errors.py:4: unprocessable() was removed "
        "(#606); raise a Refusal instead",
        "src/mortgage_backend/platform/errors.py:5: HTTPException used in "
        "unprocessable(), not directly in a route handler; raise a Refusal instead",
    ]


def test_a_caller_of_the_removed_helper_is_caught() -> None:
    assert _check(
        lending__mortgages="""
        from fastapi import APIRouter
        from mortgage_backend.platform.errors import unprocessable
        router = APIRouter()

        @router.get("/mortgages")
        def list_mortgages() -> None:
            raise unprocessable("The date cannot be in the future")
        """
    ) == [
        "src/mortgage_backend/lending/mortgages.py:3: unprocessable() was removed "
        "(#606); raise a Refusal instead",
        "src/mortgage_backend/lending/mortgages.py:8: unprocessable() was removed "
        "(#606); raise a Refusal instead",
    ]


def test_aliases_module_paths_and_subclasses_are_caught() -> None:
    assert _check(
        a="""
        from fastapi import APIRouter
        from fastapi import HTTPException as Http
        router = APIRouter()

        def refuse() -> None:
            raise Http(422, "no")
        """,
        b="""
        import fastapi
        import starlette.exceptions
        router = fastapi.APIRouter()

        def refuse() -> None:
            raise fastapi.HTTPException(422, "no")

        def refuse_too() -> None:
            raise starlette.exceptions.HTTPException(422, "no")

        class Refused(fastapi.HTTPException):
            pass
        """,
    ) == [
        "src/mortgage_backend/a.py:2: domain module imports FastAPI/Starlette; "
        "raise a Refusal, or add the module to HTTP_LAYER if it is part of the request",
        "src/mortgage_backend/a.py:3: domain module imports FastAPI/Starlette; "
        "raise a Refusal, or add the module to HTTP_LAYER if it is part of the request",
        "src/mortgage_backend/a.py:7: HTTPException used in refuse(), "
        "not directly in a route handler; raise a Refusal instead",
        "src/mortgage_backend/b.py:2: domain module imports FastAPI/Starlette; "
        "raise a Refusal, or add the module to HTTP_LAYER if it is part of the request",
        "src/mortgage_backend/b.py:3: domain module imports FastAPI/Starlette; "
        "raise a Refusal, or add the module to HTTP_LAYER if it is part of the request",
        "src/mortgage_backend/b.py:7: HTTPException used in refuse(), "
        "not directly in a route handler; raise a Refusal instead",
        "src/mortgage_backend/b.py:10: HTTPException used in refuse_too(), "
        "not directly in a route handler; raise a Refusal instead",
        "src/mortgage_backend/b.py:12: HTTPException used at module level, "
        "not directly in a route handler; raise a Refusal instead",
    ]


def test_a_domain_module_may_not_even_catch_one() -> None:
    assert _check(
        lending__refusals="""
        from fastapi import HTTPException

        def named() -> None:
            try:
                pass
            except HTTPException:
                raise
        """
    ) == [
        "src/mortgage_backend/lending/refusals.py:2: domain module imports "
        "FastAPI/Starlette; raise a Refusal, or add the module to HTTP_LAYER if it is "
        "part of the request",
        "src/mortgage_backend/lending/refusals.py:7: HTTPException caught in named(), "
        "not directly in a route handler; raise a Refusal instead",
    ]


def test_a_change_function_in_a_router_module_may_not_catch_one() -> None:
    assert _check(
        lending__closing="""
        from fastapi import APIRouter, HTTPException
        router = APIRouter()

        def close() -> None:
            try:
                pass
            except HTTPException as refused:
                refused.detail = "Mortgage: " + str(refused.detail)
                raise

        @router.post("/close")
        def close_route() -> None:
            close()
        """
    ) == [
        "src/mortgage_backend/lending/closing.py:8: HTTPException caught in close(), "
        "not directly in a route handler; raise a Refusal instead",
    ]


def test_a_dependency_or_route_counts_only_in_its_own_module() -> None:
    assert _check(
        platform__clock="""
        from fastapi import Depends
        def get_today() -> None: ...
        TodayDep = Depends(get_today)
        """,
        lending__changes="""
        import requests
        from fastapi import APIRouter, HTTPException
        router = APIRouter()

        def get_today() -> None:
            raise HTTPException(400, "same name as the dependency")

        @requests.get("/not-a-route")
        def fetch() -> None:
            raise HTTPException(422, "not a FastAPI route")
        """,
    ) == [
        "src/mortgage_backend/lending/changes.py:3: domain module imports "
        "FastAPI/Starlette; raise a Refusal, or add the module to HTTP_LAYER if it is "
        "part of the request",
        "src/mortgage_backend/lending/changes.py:7: HTTPException used in get_today(), "
        "not directly in a route handler; raise a Refusal instead",
        "src/mortgage_backend/lending/changes.py:11: HTTPException used in fetch(), "
        "not directly in a route handler; raise a Refusal instead",
    ]


def test_re_exports_module_imports_and_indirect_uses_are_caught() -> None:
    assert _check(
        lending__ledger="""
        from functools import partial
        from mortgage_backend.platform.clock import HTTPException
        from fastapi import exceptions

        def refuse() -> None:
            raise HTTPException(422, "no")

        def refuse_too() -> None:
            raise exceptions.HTTPException(422, "no")

        refused = partial(HTTPException, 422)
        """
    ) == [
        "src/mortgage_backend/lending/ledger.py:4: domain module imports "
        "FastAPI/Starlette; raise a Refusal, or add the module to HTTP_LAYER if it is "
        "part of the request",
        "src/mortgage_backend/lending/ledger.py:7: HTTPException used in refuse(), "
        "not directly in a route handler; raise a Refusal instead",
        "src/mortgage_backend/lending/ledger.py:10: HTTPException used in "
        "refuse_too(), not directly in a route handler; raise a Refusal instead",
        "src/mortgage_backend/lending/ledger.py:12: HTTPException used at module "
        "level, not directly in a route handler; raise a Refusal instead",
    ]
