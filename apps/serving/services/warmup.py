"""MODEL-SERVE-002-T03. Warm the production set at startup — retrying while
the backend is not reachable yet.

The warm used to be one attempt. Under `pnpm dev` every app starts at once:
this process is up in about a second, NestJS needs several more to compile
and connect to Postgres, so the single `list_production_versions` call hit
a closed port (`HTTPConnectionPool(host='localhost', port=4000): Max
retries exceeded`) and the replica came up cold every time. A deployment
racing its backend's rollout has the same shape.

Only "the backend is not there yet" is retried — a refused connection or a
timeout. A 401 (token mismatch) or a 500 will not fix itself by waiting, so
those fail the warm at once, exactly as before. The retry window is bounded
(`SERVING_WARM_RETRY_SECONDS`): past it the replica starts cold and models
load on first /predict, so a backend outage can never leave /readyz stuck.
"""

from __future__ import annotations

import logging
import threading
from collections.abc import Callable
from dataclasses import dataclass
from time import monotonic
from typing import Any

import requests

logger = logging.getLogger("serving")

#: "The backend is not there yet". `requests` raises its own ConnectionError
#: (not the builtin); the builtin is included for clients that raise it.
RETRYABLE: tuple[type[BaseException], ...] = (
    requests.ConnectionError,
    requests.Timeout,
    ConnectionError,
)

#: Cap on the gap between attempts, so a backend that comes up late is
#: noticed within this many seconds rather than after a doubled-out wait.
MAX_DELAY_SECONDS = 15.0


@dataclass(frozen=True)
class WarmResult:
    #: Production versions the backend listed (0 when listing never succeeded).
    listed: int
    warmed: int
    failed: int
    #: Listing never succeeded — the replica starts cold.
    gave_up: bool
    attempts: int


def warm_production_set(
    descriptor_client: Any,
    loader: Any,
    *,
    retry_seconds: float,
    stop: threading.Event,
    initial_delay: float = 1.0,
    clock: Callable[[], float] = monotonic,
) -> WarmResult:
    """List the production set (retrying while the backend is unreachable),
    then load every model in it. Blocking — run it off the event loop.

    `stop` ends the wait early on shutdown, so a reload never sits out the
    whole retry window.
    """
    deadline = clock() + retry_seconds
    delay = initial_delay
    attempts = 0

    while True:
        attempts += 1
        try:
            versions = descriptor_client.list_production_versions()
            break
        except RETRYABLE as exc:
            remaining = deadline - clock()
            if remaining <= 0 or stop.is_set():
                logger.error(
                    "Backend still unreachable after %d attempt(s) (%s); "
                    "starting cold — models load on first /predict",
                    attempts,
                    exc,
                )
                return WarmResult(0, 0, 0, True, attempts)
            wait = min(delay, remaining)
            logger.warning(
                "Backend not reachable yet (%s); retrying the production-set "
                "warm in %.1fs",
                exc,
                wait,
            )
            if stop.wait(wait):
                return WarmResult(0, 0, 0, True, attempts)
            delay = min(delay * 2, MAX_DELAY_SECONDS)
        except Exception:
            logger.exception("Failed to list production versions at startup")
            return WarmResult(0, 0, 0, True, attempts)

    warmed = 0
    failed = 0
    for entry in versions:
        if stop.is_set():
            break
        model_id = entry.get("modelId")
        if not model_id:
            continue
        # A model that fails to warm is logged, not fatal: one broken model
        # must not block every other model from serving.
        try:
            descriptor = descriptor_client.get_descriptor(model_id)
            loader.get(model_id, descriptor)
            warmed += 1
        except Exception:
            failed += 1
            logger.exception("Failed to warm model %s", model_id)

    logger.info(
        "Warmed %d of %d production model(s) after %d attempt(s)",
        warmed,
        len(versions),
        attempts,
    )
    return WarmResult(len(versions), warmed, failed, False, attempts)
