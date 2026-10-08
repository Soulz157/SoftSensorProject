"""MODEL-SERVE-002-T02. Download -> verify -> framework check -> joblib.load,
in a bounded-by-bytes LRU cache. Reuses the shape `images/trainer/app/
storage.py`'s `download_verified` already proves — this is that primitive's
long-lived cousin, not a new design.
"""

from __future__ import annotations

import hashlib
import logging
import threading
from collections import OrderedDict
from pathlib import Path
from typing import Any

import joblib
import requests
import sklearn

from config import settings

logger = logging.getLogger("serving.loader")

# tmpfs-friendly scratch dir — nothing here needs to survive a restart, and
# nothing here is committed to the image (matches images/trainer's own
# ReadonlyRootfs + /scratch discipline, though this process is not
# necessarily run read-only).
SCRATCH = Path("/tmp/serving-cache")

#: T02's own stated v1 boundary — algorithms whose pickle needs torch and
#: whose training-time input is a WINDOW of history
#: (images/trainer/app/holdout.py's build_windows), which a row-list
#: /predict request cannot express. Refused at load time, before the
#: download and unpickle even start — read from the descriptor's own
#: `algorithm` field, never by sniffing the pickle.
UNSERVABLE_ALGORITHMS = frozenset({"lstm", "gru"})


class LoadError(RuntimeError):
    """Safe to surface to the /predict caller as a 422 — never a bare 500."""


def _sha256_of(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _download(url: str, dest: Path) -> Path:
    """Deliberately not lazy/streamed-to-caller — the presigned URL is
    short-lived, same reasoning `images/trainer/app/storage.py.download`
    states on itself.

    A transient network/storage failure here must become a `LoadError`,
    not an unhandled `requests` exception — `LoadError`'s own docstring
    states the invariant ("safe to surface as a 422, never a bare 500"),
    and a raw `ConnectionError` bypasses `routers/serve.py`'s mapping
    entirely, leaking a 500 with a stack trace to the caller.
    """
    try:
        with requests.get(url, stream=True, timeout=300) as response:
            response.raise_for_status()
            with dest.open("wb") as handle:
                for chunk in response.iter_content(chunk_size=1024 * 1024):
                    handle.write(chunk)
    except requests.RequestException as exc:
        dest.unlink(missing_ok=True)
        raise LoadError(f"Failed to download model artifact: {exc}") from exc
    return dest


def _check_framework_versions(recorded: dict[str, str] | None) -> None:
    """A recorded version differing from the runtime REFUSES the load; an
    absent record loads with a logged warning — missing is not the same
    claim as mismatched (MODEL-SERVE-002-T02's own addendum: the trainer
    image's digest cannot be matched here by design, since serving
    deliberately runs a DIFFERENT image — only the library versions the
    pickle actually depends on are checked).
    """
    if not recorded:
        logger.warning(
            "Loading a model with no recorded frameworkVersions — cannot "
            "verify library compatibility."
        )
        return
    runtime = {"sklearn": sklearn.__version__}
    for lib, recorded_version in recorded.items():
        if lib not in runtime:
            continue
        if runtime[lib] != recorded_version:
            raise LoadError(
                f"Framework version mismatch for {lib}: model recorded "
                f"{recorded_version}, serving runtime has {runtime[lib]}. "
                "Refusing to load rather than degrade to a warning."
            )


class _CacheEntry:
    __slots__ = ("model", "size_bytes")

    def __init__(self, model: Any, size_bytes: int) -> None:
        self.model = model
        self.size_bytes = size_bytes


class ModelLoader:
    """Bounded by BYTES, not entry count — models differ in size by orders
    of magnitude and a count-based cap sizes for the smallest one. Keyed by
    (modelId, versionId), LRU eviction.
    """

    def __init__(self, max_bytes: int | None = None) -> None:
        self.max_bytes = (
            max_bytes if max_bytes is not None else settings.SERVING_CACHE_MAX_BYTES
        )
        self._cache: "OrderedDict[tuple[str, str], _CacheEntry]" = OrderedDict()
        self._total_bytes = 0
        self._lock = threading.Lock()
        SCRATCH.mkdir(parents=True, exist_ok=True)

    def get(self, model_id: str, descriptor: dict[str, Any]) -> Any:
        key = (model_id, str(descriptor["versionId"]))
        with self._lock:
            entry = self._cache.get(key)
            if entry is not None:
                self._cache.move_to_end(key)
                return entry.model

        algorithm = descriptor.get("algorithm")
        if algorithm in UNSERVABLE_ALGORITHMS:
            raise LoadError(
                f"Algorithm {algorithm!r} is not servable by this process "
                "— it requires torch and a window-shaped request contract "
                "a synchronous row-list /predict does not support (v1 "
                "boundary, see MODEL-SERVE-002-T02)."
            )

        dest = SCRATCH / f"{key[0]}-{key[1]}.joblib"
        _download(descriptor["modelUrl"], dest)
        actual_checksum = _sha256_of(dest)
        expected = descriptor.get("modelChecksum")
        # Honest-legacy-null: a null expected checksum (a run predating
        # model_sha256 in the manifest) is existence-only, logged. A
        # MISMATCH against a real recorded checksum is never a warning.
        if expected is None:
            logger.warning(
                "Model %s/%s has no recorded modelChecksum — loading "
                "unverified (legacy run).",
                model_id,
                key[1],
            )
        elif actual_checksum != expected:
            dest.unlink(missing_ok=True)
            raise LoadError(
                f"Model checksum mismatch for {model_id}: expected "
                f"{expected}, got {actual_checksum}. Refusing to load."
            )

        _check_framework_versions(descriptor.get("frameworkVersions"))

        # Provenance only, never matched — serving deliberately runs a
        # DIFFERENT image from the trainer that produced this pickle
        # (decisions.training_and_serving_are_separate_planes), so a digest
        # mismatch is expected and meaningless. Logged so an operator
        # debugging a framework surprise knows which trainer image to go
        # look at.
        image_digest = descriptor.get("imageDigest")
        if image_digest:
            logger.info(
                "Loading %s/%s, trained by image %s",
                model_id,
                key[1],
                image_digest,
            )

        model = joblib.load(dest)
        size_bytes = dest.stat().st_size
        dest.unlink(missing_ok=True)

        with self._lock:
            self._cache[key] = _CacheEntry(model, size_bytes)
            self._total_bytes += size_bytes
            self._evict_if_needed()
        return model

    def _evict_if_needed(self) -> None:
        while self._total_bytes > self.max_bytes and self._cache:
            _, evicted = self._cache.popitem(last=False)
            self._total_bytes -= evicted.size_bytes

    def invalidate(self, model_id: str, version_id: str) -> None:
        with self._lock:
            entry = self._cache.pop((model_id, str(version_id)), None)
            if entry is not None:
                self._total_bytes -= entry.size_bytes
