"""MODEL-SERVE-002-T02/V04. Loader unit tests — checksum refusal,
framework-mismatch refusal, unservable-algorithm refusal before download,
LRU eviction by bytes. `_download` is monkeypatched to copy a local file
rather than making a real HTTP call — the object bytes are what's under
test, not the transport.
"""

from __future__ import annotations

from pathlib import Path

import joblib
import pytest

import services.loader as loader_mod
from services.loader import LoadError, ModelLoader, _download, _sha256_of


class _TinyModel:
    def predict(self, X):
        return [0.5] * len(X)


@pytest.fixture()
def model_path(tmp_path: Path) -> Path:
    path = tmp_path / "model.joblib"
    joblib.dump(_TinyModel(), path)
    return path


@pytest.fixture(autouse=True)
def _patch_scratch(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(loader_mod, "SCRATCH", tmp_path / "cache")
    (tmp_path / "cache").mkdir(parents=True, exist_ok=True)


def _fake_download(source: Path):
    def _inner(url: str, dest: Path) -> Path:
        dest.write_bytes(source.read_bytes())
        return dest

    return _inner


def _descriptor(model_path: Path, **overrides) -> dict:
    base = {
        "versionId": "v1",
        "algorithm": "ols",
        "modelUrl": str(model_path),
        "modelChecksum": _sha256_of(model_path),
        "frameworkVersions": None,
    }
    base.update(overrides)
    return base


def test_checksum_mismatch_refuses_load(
    model_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(loader_mod, "_download", _fake_download(model_path))
    loader = ModelLoader(max_bytes=10_000_000)
    descriptor = _descriptor(model_path, modelChecksum="0" * 64)
    with pytest.raises(LoadError, match="checksum mismatch"):
        loader.get("model-1", descriptor)


def test_null_checksum_loads_unverified_with_a_warning(
    model_path: Path, monkeypatch: pytest.MonkeyPatch, caplog
) -> None:
    monkeypatch.setattr(loader_mod, "_download", _fake_download(model_path))
    loader = ModelLoader(max_bytes=10_000_000)
    descriptor = _descriptor(model_path, modelChecksum=None)
    with caplog.at_level("WARNING"):
        model = loader.get("model-1", descriptor)
    assert model is not None
    assert any("unverified" in r.message for r in caplog.records)


def test_framework_version_mismatch_refuses_load(
    model_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(loader_mod, "_download", _fake_download(model_path))
    loader = ModelLoader(max_bytes=10_000_000)
    descriptor = _descriptor(
        model_path, frameworkVersions={"sklearn": "0.0.1-does-not-exist"}
    )
    with pytest.raises(LoadError, match="Framework version mismatch"):
        loader.get("model-1", descriptor)


def test_unservable_algorithm_refused_before_download(
    model_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    called = {"count": 0}

    def _tracking_download(url: str, dest: Path) -> Path:
        called["count"] += 1
        return _fake_download(model_path)(url, dest)

    monkeypatch.setattr(loader_mod, "_download", _tracking_download)
    loader = ModelLoader(max_bytes=10_000_000)
    descriptor = _descriptor(model_path, algorithm="lstm")
    with pytest.raises(LoadError, match="lstm"):
        loader.get("model-1", descriptor)
    assert called["count"] == 0, "must refuse before ever downloading"


def test_lru_eviction_by_bytes(
    model_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(loader_mod, "_download", _fake_download(model_path))
    size = model_path.stat().st_size
    # Room for exactly one model at a time.
    loader = ModelLoader(max_bytes=size + 1)

    loader.get("model-1", _descriptor(model_path, versionId="v1"))
    assert ("model-1", "v1") in loader._cache

    loader.get("model-2", _descriptor(model_path, versionId="v2"))
    assert ("model-2", "v2") in loader._cache
    assert ("model-1", "v1") not in loader._cache, "oldest entry must be evicted"


def test_download_network_failure_becomes_load_error(tmp_path: Path) -> None:
    """A `requests` transport failure must never reach the caller as a bare
    500 — LoadError's own docstring states the invariant. Port 1 is
    reserved/unassigned, guaranteeing an immediate ConnectionError with no
    real network dependency."""
    dest = tmp_path / "model.joblib"
    with pytest.raises(LoadError, match="Failed to download"):
        _download("http://127.0.0.1:1/model.joblib", dest)
    assert not dest.exists(), "partial download must not linger"


def test_cache_hit_skips_download(
    model_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    calls = {"count": 0}

    def _counting_download(url: str, dest: Path) -> Path:
        calls["count"] += 1
        return _fake_download(model_path)(url, dest)

    monkeypatch.setattr(loader_mod, "_download", _counting_download)
    loader = ModelLoader(max_bytes=10_000_000)
    descriptor = _descriptor(model_path)
    loader.get("model-1", descriptor)
    loader.get("model-1", descriptor)
    assert calls["count"] == 1
