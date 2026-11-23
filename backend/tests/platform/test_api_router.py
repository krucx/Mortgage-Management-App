"""The `/api` prefix is declared once, by the master router in `main`."""

import importlib
import pkgutil

from fastapi import APIRouter

import mortgage_backend


def test_domain_routers_do_not_repeat_the_api_prefix():
    prefixed = []
    for module_info in pkgutil.walk_packages(
        mortgage_backend.__path__, "mortgage_backend."
    ):
        router = getattr(importlib.import_module(module_info.name), "router", None)
        if isinstance(router, APIRouter) and router.prefix:
            prefixed.append(module_info.name)
    assert prefixed == []
