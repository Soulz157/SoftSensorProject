"""MODEL-SERVE-002-T04. End-to-end route test against a real TestClient —
the row cap, and the full descriptor -> loader -> predict wiring, with the
descriptor client and loader monkeypatched at the app-state level (no real
backend or object storage; that is what MODEL-SERVE-002-V01 exercises).
"""

from __future__ import annotations

import pytest
import requests
from fastapi.testclient import TestClient

from config import settings
from main import create_app


class _SumModel:
    def predict(self, X):
        return X.sum(axis=1).to_numpy()


class _FakeLogResponse:
    status_code = 200
    text = ""


class _FakeSession:
    """MODEL-SERVE-005-T01. `descriptor_client.session` is what
    `log_prediction`'s background task POSTs through — a real
    `requests.Session` here would attempt a real network call during a test
    that has nothing to do with logging. Records what was sent instead."""

    def __init__(self) -> None:
        self.posted: list[dict] = []

    def post(self, url, json=None, timeout=None):
        self.posted.append({"url": url, "json": json})
        return _FakeLogResponse()


class _StubDescriptorClient:
    def __init__(self, descriptor: dict) -> None:
        self._descriptor = descriptor
        self.session = _FakeSession()

    def list_production_versions(self):
        return []

    def get_descriptor(self, model_id: str, *, force: bool = False):
        return self._descriptor


class _StubLoader:
    def __init__(self, model) -> None:
        self._model = model

    def get(self, model_id: str, descriptor: dict):
        return self._model


@pytest.fixture()
def client(monkeypatch: pytest.MonkeyPatch) -> TestClient:
    descriptor = {
        "versionId": "v1",
        "version": 3,
        "algorithm": "ols",
        "featureColumns": ["a", "b"],
        "scalers": {},
        "scalingParams": {
            "a": {"min": 0.0, "max": 10.0},
            "b": {"min": 0.0, "max": 10.0},
        },
        "derivedFromTarget": [],
    }
    app = create_app()
    with TestClient(app) as test_client:
        app.state.descriptor_client = _StubDescriptorClient(descriptor)
        app.state.loader = _StubLoader(_SumModel())
        app.state.ready = True
        yield test_client


def test_predict_happy_path(client: TestClient) -> None:
    response = client.post(
        "/v1/models/model-1/predict",
        json={"rows": [{"a": 5.0, "b": 5.0}]},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["modelId"] == "model-1"
    assert body["version"] == 3
    assert body["predictions"] == pytest.approx([1.0])


def test_predict_refuses_over_the_row_cap(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(settings, "SERVING_MAX_ROWS", 2)
    response = client.post(
        "/v1/models/model-1/predict",
        json={"rows": [{"a": 1.0, "b": 1.0}] * 3},
    )
    assert response.status_code == 422
    assert "3 rows" in response.json()["detail"]


def test_predict_names_the_missing_column(client: TestClient) -> None:
    response = client.post(
        "/v1/models/model-1/predict",
        json={"rows": [{"a": 1.0}]},
    )
    assert response.status_code == 422
    assert "'b'" in response.json()["detail"]


def test_predict_logs_the_request_when_sampled_in(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(settings, "SERVING_LOG_SAMPLE_RATE", 1.0)
    response = client.post(
        "/v1/models/model-1/predict",
        json={"rows": [{"a": 5.0, "b": 5.0}]},
    )
    assert response.status_code == 200

    session = client.app.state.descriptor_client.session
    assert len(session.posted) == 1
    body = session.posted[0]["json"]
    assert body["modelId"] == "model-1"
    assert body["modelVersionId"] == "v1"
    assert body["rowCount"] == 1
    assert body["loggedRows"] == 1
    assert body["samplingRate"] == 1.0
    assert body["rows"] == [{"features": {"a": 5.0, "b": 5.0}, "prediction": 1.0}]
    assert body["featureStats"]["a"]["n"] == 1
    # MODEL-SERVE-005, live-verified regression: `datetime.isoformat()`'s
    # `+00:00` offset was silently rejected by the backend's
    # `z.string().datetime()` (no `{offset: true}`), and the failure never
    # surfaced anywhere because this whole path is deliberately
    # fail-silent — every logged request was being dropped. `Z` matches
    # what `new Date().toISOString()` already sends everywhere else in
    # this system.
    assert body["requestedAt"].endswith("Z")
    assert "+00:00" not in body["requestedAt"]


def test_predict_does_not_log_when_sampled_out(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(settings, "SERVING_LOG_SAMPLE_RATE", 0.0)
    response = client.post(
        "/v1/models/model-1/predict",
        json={"rows": [{"a": 5.0, "b": 5.0}]},
    )
    assert response.status_code == 200

    session = client.app.state.descriptor_client.session
    assert session.posted == []


def test_predict_succeeds_even_when_logging_would_fail(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """MODEL-SERVE-005-T01's own structural guarantee: a broken/unreachable
    log sink must never surface anywhere near the /predict response."""
    monkeypatch.setattr(settings, "SERVING_LOG_SAMPLE_RATE", 1.0)

    def _raise_post(self, *args, **kwargs):
        raise requests.exceptions.ConnectionError("backend unreachable")

    monkeypatch.setattr(
        client.app.state.descriptor_client.session.__class__, "post", _raise_post
    )

    response = client.post(
        "/v1/models/model-1/predict",
        json={"rows": [{"a": 5.0, "b": 5.0}]},
    )
    assert response.status_code == 200
    assert response.json()["predictions"] == pytest.approx([1.0])
