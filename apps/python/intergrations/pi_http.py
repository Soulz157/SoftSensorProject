"""
Request timeouts for the vendored PI Web API SDK.

The SDK builds every call as `requests.get(url, auth=..., headers=...,
verify=...)` (osisoft/pidevclub/piwebapi/rest.py) with no `timeout=`, and
`RESTClientObject` exposes no knob for one. `requests` therefore waits forever:
a PI host that completes the TCP/TLS handshake and then goes silent parks the
caller indefinitely.

`rest.py` is the only SDK module that imports `requests`, and it resolves the
module global at call time, so swapping that one attribute for a proxy bounds
every PI call and touches nothing else in the process — no global `requests`
patch, no `socket.setdefaulttimeout` (which would also cap the long data fetch
and the DB sockets).

Budgets are scoped per operation with `pi_timeout(...)` and chosen to expire
inside the NestJS caller's own budget (see apps/backend/src/lib/python-client.ts
PYTHON_TIMEOUT), so the user gets a real reason instead of a generic connector
timeout.
"""
from __future__ import annotations

from contextlib import contextmanager
from contextvars import ContextVar
from typing import Any, Iterator

from osisoft.pidevclub.piwebapi import rest as _pi_rest

# (connect, read) seconds — the tuple form `requests` accepts.
Timeout = tuple[float, float]

DEFAULT_TIMEOUT: Timeout = (5.0, 30.0)
TEST_TIMEOUT: Timeout = (5.0, 10.0)
METADATA_TIMEOUT: Timeout = (5.0, 30.0)
FETCH_TIMEOUT: Timeout = (5.0, 110.0)

_timeout: ContextVar[Timeout] = ContextVar("pi_timeout", default=DEFAULT_TIMEOUT)

_VERBS = frozenset(
    {"get", "post", "put", "patch", "delete", "head", "options", "request"}
)


@contextmanager
def pi_timeout(value: Timeout) -> Iterator[None]:
    """Scope the timeout applied to PI calls made in this context.

    Each thread carries its own context, so a value set inside a FastAPI
    threadpool worker never leaks into another request. `asyncio.to_thread`
    copies the context, so the async fetch path inherits it too.
    """
    token = _timeout.set(value)
    try:
        yield
    finally:
        _timeout.reset(token)


class _TimeoutRequests:
    """Stand-in for the `requests` module that injects the current timeout.

    Only the HTTP verbs are wrapped; every other attribute passes straight
    through, so the SDK sees the module it expects.
    """

    # Looked up by install_pi_timeouts() to stay idempotent under --reload.
    _pi_timeout_proxy = True

    def __init__(self, wrapped: Any) -> None:
        self._wrapped = wrapped

    def __getattr__(self, name: str) -> Any:
        attr = getattr(self._wrapped, name)
        if name not in _VERBS or not callable(attr):
            return attr

        def _call(*args: Any, **kwargs: Any) -> Any:
            # setdefault, so an explicit timeout from a caller still wins.
            kwargs.setdefault("timeout", _timeout.get())
            return attr(*args, **kwargs)

        return _call


def install_pi_timeouts() -> None:
    """Bound every PI Web API request. Safe to call more than once."""
    if getattr(_pi_rest.requests, "_pi_timeout_proxy", False):
        return
    _pi_rest.requests = _TimeoutRequests(_pi_rest.requests)


__all__ = [
    "DEFAULT_TIMEOUT",
    "FETCH_TIMEOUT",
    "METADATA_TIMEOUT",
    "TEST_TIMEOUT",
    "Timeout",
    "install_pi_timeouts",
    "pi_timeout",
]
