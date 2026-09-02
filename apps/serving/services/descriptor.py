"""MODEL-SERVE-002-T02/T03/T07. Talks to the ONE thing this process is
allowed to talk to besides a presigned object URL — the NestJS descriptor
endpoint (`GET /api/v1/authorized/serving/...`). No Postgres, no MinIO
credentials here; see decisions.serving_host_undecided's resolution.

decisions.serving_cache_staleness_bound: a 30s TTL cache on the per-model
descriptor lookup is the CONTRACT this feature commits to — "a promoted
version is serving on every replica within 30 seconds, plus the duration
of requests already in flight." Not an emergent property.
"""

from __future__ import annotations

import threading
import time
from typing import Any

import requests

from config import settings

_ROUTE_PREFIX = "/api/v1/authorized/serving"


class DescriptorError(RuntimeError):
    """No PRODUCTION version, or the backend refused the request. Safe to
    surface to the /predict caller as a 404/422 — never a bare 500."""


class _CacheEntry:
    __slots__ = ("value", "expires_at")

    def __init__(self, value: dict[str, Any], expires_at: float) -> None:
        self.value = value
        self.expires_at = expires_at


class DescriptorClient:
    """One instance per process, held on `app.state` (see main.py) — the
    TTL cache is per-replica by design: each replica independently re-polls
    within the staleness bound, rather than sharing state that would need
    its own consistency story.
    """

    def __init__(self, session: requests.Session | None = None) -> None:
        self.session = session or requests.Session()
        self.session.headers.update(
            {"Authorization": f"Bearer {settings.SERVING_API_TOKEN}"}
        )
        self._cache: dict[str, _CacheEntry] = {}
        self._lock = threading.Lock()

    def _base(self) -> str:
        return settings.BACKEND_API_BASE.rstrip("/")

    def list_production_versions(self) -> list[dict[str, Any]]:
        """T03. The warm set — every (modelId, versionId, version) currently
        PRODUCTION, across every model."""
        resp = self.session.get(
            f"{self._base()}{_ROUTE_PREFIX}/production-versions", timeout=15
        )
        resp.raise_for_status()
        body: dict[str, Any] = resp.json()
        data = body.get("data")
        return data if isinstance(data, list) else []

    def get_descriptor(
        self, model_id: str, *, force: bool = False
    ) -> dict[str, Any]:
        now = time.monotonic()
        if not force:
            with self._lock:
                entry = self._cache.get(model_id)
                if entry is not None and entry.expires_at > now:
                    return entry.value

        resp = self.session.get(
            f"{self._base()}{_ROUTE_PREFIX}/models/{model_id}/descriptor",
            timeout=15,
        )
        if resp.status_code == 404:
            raise DescriptorError(f"Model {model_id} has no PRODUCTION version.")
        if resp.status_code >= 400:
            detail = _extract_message(resp)
            raise DescriptorError(
                f"Descriptor lookup for model {model_id} failed "
                f"({resp.status_code}): {detail}"
            )

        body: dict[str, Any] = resp.json()
        data = body.get("data")
        if not isinstance(data, dict):
            raise DescriptorError(
                f"Descriptor response for model {model_id} had no `data`."
            )

        with self._lock:
            self._cache[model_id] = _CacheEntry(
                data, now + settings.SERVING_DESCRIPTOR_TTL_SECONDS
            )
        return data

    def invalidate(self, model_id: str) -> None:
        with self._lock:
            self._cache.pop(model_id, None)


def _extract_message(resp: requests.Response) -> str:
    try:
        body = resp.json()
        message = body.get("message")
        return str(message) if message else resp.text[:200]
    except ValueError:
        return resp.text[:200]
