"""MODEL-SERVE-002-T03. The startup warm retries while the backend is not
reachable yet, and only then.

`initial_delay` is tiny so the retry loop runs for real (real
`threading.Event.wait`) without making the suite slow.
"""

from __future__ import annotations

import threading

import requests

from services.warmup import warm_production_set


class FakeClient:
    """Fails `list_production_versions` with `errors` in order, then lists."""

    def __init__(self, errors: list[BaseException], versions=None) -> None:
        self.errors = list(errors)
        self.versions = versions if versions is not None else []
        self.list_calls = 0
        self.descriptor_calls: list[str] = []

    def list_production_versions(self):
        self.list_calls += 1
        if self.errors:
            raise self.errors.pop(0)
        return self.versions

    def get_descriptor(self, model_id: str):
        self.descriptor_calls.append(model_id)
        if model_id == "broken":
            raise RuntimeError("descriptor 500")
        return {"versionId": f"v-{model_id}"}


class FakeLoader:
    def __init__(self) -> None:
        self.loaded: list[str] = []

    def get(self, model_id: str, descriptor):
        self.loaded.append(model_id)


def _warm(client, *, retry_seconds=5.0, stop=None):
    loader = FakeLoader()
    result = warm_production_set(
        client,
        loader,
        retry_seconds=retry_seconds,
        stop=stop or threading.Event(),
        initial_delay=0.01,
    )
    return result, loader


def test_retries_a_refused_connection_until_the_backend_answers() -> None:
    refused = requests.ConnectionError("Max retries exceeded")
    client = FakeClient(
        [refused, refused, requests.Timeout("slow")],
        versions=[{"modelId": "m1"}, {"modelId": "m2"}],
    )

    result, loader = _warm(client)

    assert client.list_calls == 4
    assert loader.loaded == ["m1", "m2"]
    assert (result.listed, result.warmed, result.gave_up) == (2, 2, False)
    assert result.attempts == 4


def test_gives_up_after_the_retry_window_and_starts_cold() -> None:
    client = FakeClient([ConnectionError("down")] * 1000)

    result, loader = _warm(client, retry_seconds=0.05)

    assert result.gave_up is True
    assert loader.loaded == []
    assert 1 < client.list_calls < 1000


def test_does_not_retry_an_error_waiting_cannot_fix() -> None:
    """A 401 (token mismatch) stays a 401 — fail the warm at once."""
    client = FakeClient([requests.HTTPError("401 Unauthorized")])

    result, _ = _warm(client)

    assert client.list_calls == 1
    assert result.gave_up is True


def test_stop_ends_a_pending_retry_wait() -> None:
    stop = threading.Event()
    stop.set()
    client = FakeClient([ConnectionError("down")] * 10)

    result, _ = _warm(client, retry_seconds=60.0, stop=stop)

    assert client.list_calls == 1
    assert result.gave_up is True


def test_one_broken_model_does_not_block_the_others() -> None:
    client = FakeClient(
        [], versions=[{"modelId": "m1"}, {"modelId": "broken"}, {}, {"modelId": "m3"}]
    )

    result, loader = _warm(client)

    assert loader.loaded == ["m1", "m3"]
    assert (result.listed, result.warmed, result.failed) == (4, 2, 1)
