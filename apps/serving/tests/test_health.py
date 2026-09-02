"""MODEL-SERVE-002-T03. /healthz answers without touching MinIO or Postgres
— including when the backend (the only thing this process talks to) is
unreachable. /readyz reports 503 while warming.
"""

from __future__ import annotations

from fastapi.testclient import TestClient

import services.descriptor as descriptor_mod
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


def test_readyz_reports_ready_after_a_failed_warm_attempt(monkeypatch) -> None:
    """A backend outage at boot must not crash the process or leave /readyz
    stuck forever — the warm PASS completing (even having found nothing to
    warm) is what flips ready, per main.py's own lifespan comment."""

    def _raise(*args, **kwargs):
        raise ConnectionError("backend unreachable")

    monkeypatch.setattr(
        descriptor_mod.DescriptorClient, "list_production_versions", _raise
    )
    app = create_app()
    with TestClient(app) as client:
        response = client.get("/readyz")
    assert response.status_code == 200
    assert response.json() == {"status": "ready"}
