"""The HTTP boundary stays put: domain code refuses with a `Refusal`, and only the HTTP
layer speaks HTTP (#606, architecture review pass 8).

An `HTTPException` is made only directly inside
- a route handler: a function registered with a router or app decorator
  (`@router.get(...)`, `@app.api_route(...)`), or
- a FastAPI dependency: a function passed to `Depends(...)`, which is part of the
  request, as a route handler is, or
- a site in `ALLOWED_SITES`, each with its reason.

Domain modules (any module that registers no route and is not in `HTTP_LAYER`) import
nothing from FastAPI or Starlette. The removed helper that built an `HTTPException` for a
refusal (`unprocessable`) does not come back. Each violation names its file and line.
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

# (module, function) -> why that function may make an HTTPException.
ALLOWED_SITES = {
    ("mortgage_backend/platform/upload_limit.py", "counted"): (
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
HTTP_PACKAGES = ("fastapi", "starlette")
HTTP_EXCEPTION_MODULES = {"fastapi", "fastapi.exceptions", "starlette.exceptions"}

Function = ast.FunctionDef | ast.AsyncFunctionDef


def _is_route_handler(function: Function) -> bool:
    for decorator in function.decorator_list:
        if (
            isinstance(decorator, ast.Call)
            and isinstance(decorator.func, ast.Attribute)
            and decorator.func.attr in ROUTE_DECORATORS
        ):
            return True
    return False


def _dependencies(trees: dict[str, ast.Module]) -> set[str]:
    """Names of the functions passed to `Depends(...)` anywhere."""
    names = set()
    for tree in trees.values():
        for node in ast.walk(tree):
            if (
                isinstance(node, ast.Call)
                and isinstance(node.func, ast.Name)
                and node.func.id == "Depends"
                and node.args
                and isinstance(node.args[0], ast.Name)
            ):
                names.add(node.args[0].id)
    return names


def _http_exception_names(tree: ast.Module) -> tuple[set[str], set[str]]:
    """How this module can name HTTPException: bare names (`HTTPException`, or an
    alias) and modules it is reached through (`fastapi.HTTPException`)."""
    names, modules = set(), set()
    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom) and node.module in HTTP_EXCEPTION_MODULES:
            for alias in node.names:
                if alias.name == "HTTPException":
                    names.add(alias.asname or alias.name)
        elif isinstance(node, ast.Import):
            for alias in node.names:
                if alias.name in HTTP_EXCEPTION_MODULES:
                    modules.add(alias.asname or alias.name)
    return names, modules


def _names_http_exception(node: ast.expr, names: set[str], modules: set[str]) -> bool:
    if isinstance(node, ast.Name):
        return node.id in names
    if isinstance(node, ast.Attribute) and node.attr == "HTTPException":
        return ast.unparse(node.value) in modules
    return False


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


class _Sites(ast.NodeVisitor):
    """Every HTTPException made in one module, with its innermost enclosing function."""

    def __init__(self, names: set[str], modules: set[str]) -> None:
        self.names, self.modules = names, modules
        self.stack: list[Function] = []
        self.sites: list[tuple[int, Function | None]] = []
        self.removed: list[tuple[int, str]] = []
        self.routes = 0

    def _function(self, node: Function) -> None:
        if node.name in REMOVED_HELPERS:
            self.removed.append((node.lineno, node.name))
        if _is_route_handler(node):
            self.routes += 1
        self.stack.append(node)
        self.generic_visit(node)
        self.stack.pop()

    visit_FunctionDef = _function
    visit_AsyncFunctionDef = _function

    def _site(self, node: ast.AST) -> None:
        self.sites.append((node.lineno, self.stack[-1] if self.stack else None))

    def visit_Call(self, node: ast.Call) -> None:
        if _names_http_exception(node.func, self.names, self.modules):
            self._site(node)
        name = node.func.attr if isinstance(node.func, ast.Attribute) else None
        if isinstance(node.func, ast.Name):
            name = node.func.id
        if name in REMOVED_HELPERS:
            self.removed.append((node.lineno, name))
        self.generic_visit(node)

    def visit_ImportFrom(self, node: ast.ImportFrom) -> None:
        for alias in node.names:
            if alias.name in REMOVED_HELPERS:
                self.removed.append((node.lineno, alias.name))

    def visit_Raise(self, node: ast.Raise) -> None:
        if node.exc is not None and _names_http_exception(
            node.exc, self.names, self.modules
        ):
            self._site(node)  # `raise HTTPException`, the class itself
        self.generic_visit(node)

    def visit_ClassDef(self, node: ast.ClassDef) -> None:
        if any(_names_http_exception(b, self.names, self.modules) for b in node.bases):
            self._site(node)  # a subclass would carry HTTP out of the boundary
        self.generic_visit(node)


def http_boundary_violations(sources: dict[str, str]) -> list[str]:
    """`sources` maps a module path under src/ to its code; one line per violation,
    `src/<path>:<line>: <what>`, in file and line order."""
    trees = {path: ast.parse(code, path) for path, code in sources.items()}
    dependencies = _dependencies(trees)
    violations: list[tuple[str, int, str]] = []
    for path, tree in sorted(trees.items()):
        sites = _Sites(*_http_exception_names(tree))
        sites.visit(tree)
        for line, function in sites.sites:
            if function is not None and (
                _is_route_handler(function)
                or function.name in dependencies
                or (path, function.name) in ALLOWED_SITES
            ):
                continue
            where = f"in {function.name}()" if function else "at module level"
            violations.append(
                (
                    path,
                    line,
                    f"HTTPException made {where}, not directly in a route handler; "
                    "raise a Refusal instead",
                )
            )
        for line, name in sites.removed:
            violations.append(
                (path, line, f"{name}() was removed (#606); raise a Refusal instead")
            )
        if not sites.routes and path not in HTTP_LAYER:
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
        defined = {
            node.name
            for node in ast.walk(ast.parse(sources[path]))
            if isinstance(node, ast.FunctionDef | ast.AsyncFunctionDef)
        }
        assert function in defined, f"{path}: no function {function}()"


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
        "src/mortgage_backend/lending/closing.py:7: HTTPException made in check(), "
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
        "src/mortgage_backend/routes.py:8: HTTPException made in refuse(), "
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
        "src/mortgage_backend/platform/errors.py:4: unprocessable() was removed "
        "(#606); raise a Refusal instead",
        "src/mortgage_backend/platform/errors.py:5: HTTPException made in "
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
        "src/mortgage_backend/a.py:7: HTTPException made in refuse(), "
        "not directly in a route handler; raise a Refusal instead",
        "src/mortgage_backend/b.py:2: domain module imports FastAPI/Starlette; "
        "raise a Refusal, or add the module to HTTP_LAYER if it is part of the request",
        "src/mortgage_backend/b.py:3: domain module imports FastAPI/Starlette; "
        "raise a Refusal, or add the module to HTTP_LAYER if it is part of the request",
        "src/mortgage_backend/b.py:7: HTTPException made in refuse(), "
        "not directly in a route handler; raise a Refusal instead",
        "src/mortgage_backend/b.py:10: HTTPException made in refuse_too(), "
        "not directly in a route handler; raise a Refusal instead",
        "src/mortgage_backend/b.py:12: HTTPException made at module level, "
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
    ]
