"""MODEL-SERVE-002-T04. End-to-end route test against a real TestClient —
the row cap, and the full descriptor -> loader -> predict wiring, with the
descriptor client and loader monkeypatched at the app-state level (no real
backend or object storage; that is what MODEL-SERVE-002-V01 exercises).
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from config import settings
from main import create_app


class _SumModel:
    def predict(self, X):
        return X.sum(axis=1).to_numpy()


class _StubDescriptorClient:
    def __init__(self, descriptor: dict) -> None:
        self._descriptor = descriptor

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
