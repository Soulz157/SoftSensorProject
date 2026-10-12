"""MODEL-SERVE-002-T03. /healthz answers without touching MinIO or Postgres
— including when the backend (the only thing this process talks to) is
unreachable. /readyz reports 503 while warming.
"""

from __future__ import annotations

import time

from fastapi.testclient import TestClient

import services.descriptor as descriptor_mod
from config import settings
from main import create_app


def test_healthz_answers_even_when_backend_is_unreachable(
    monkeypatch,
) -> None:
    def _raise(*args, **kwargs):
        raise ConnectionError("backend unreachable")

    monkeypatch.setattr(
        descriptor_mod.DescriptorClient, "list_production_versions", _raise
    )
    app = create_app()
    with TestClient(app) as client:
        response = client.get("/healthz")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def _wait_until_ready(client: TestClient, seconds: float = 5.0):
    deadline = time.monotonic() + seconds
    while True:
        response = client.get("/readyz")
        if response.status_code == 200 or time.monotonic() > deadline:
            return response
        time.sleep(0.02)


def test_readyz_reports_ready_after_a_failed_warm_attempt(monkeypatch) -> None:
    """A backend outage at boot must not crash the process or leave /readyz
    stuck forever — the warm PASS ending (even having found nothing to
    warm) is what flips ready, per main.py's own lifespan comment. A zero
    retry window makes that end immediate."""

    def _raise(*args, **kwargs):
        raise ConnectionError("backend unreachable")

    monkeypatch.setattr(
        descriptor_mod.DescriptorClient, "list_production_versions", _raise
    )
    monkeypatch.setattr(settings, "SERVING_WARM_RETRY_SECONDS", 0.0)
    app = create_app()
    with TestClient(app) as client:
        response = _wait_until_ready(client)
    assert response.status_code == 200
    assert response.json() == {"status": "ready"}


def test_readyz_reports_warming_while_the_backend_is_still_coming_up(
    monkeypatch,
) -> None:
    """The `pnpm dev` race: serving is up before NestJS. Retrying, it is
    live (/healthz) but not ready — and it never blocks shutdown."""

    def _raise(*args, **kwargs):
        raise ConnectionError("backend unreachable")

    monkeypatch.setattr(
        descriptor_mod.DescriptorClient, "list_production_versions", _raise
    )
    monkeypatch.setattr(settings, "SERVING_WARM_RETRY_SECONDS", 60.0)
    app = create_app()
    started = time.monotonic()
    with TestClient(app) as client:
        assert client.get("/healthz").status_code == 200
        response = client.get("/readyz")
    assert response.status_code == 503
    assert response.json() == {"status": "warming"}
    # Shutdown interrupted the 60s retry window instead of sitting it out.
    assert time.monotonic() - started < 5
