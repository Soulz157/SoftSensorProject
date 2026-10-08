"""Bytes in, bytes out. No run token, ever.

This container never holds S3 credentials, matching the rule the connector
service states on itself: every transfer here rides a presigned URL.

`download_verified` and `upload_artifacts` exist because the original file
performed each pattern four times and two times respectively, identically each
time apart from the message. Both pass the deletion test: remove them and the
same code reappears at every call site.
"""

from __future__ import annotations

import hashlib
from pathlib import Path
from typing import Callable, Mapping

import requests

from api import RunApi

LogFn = Callable[..., None]


def download(url: str, dest: Path) -> Path:
    """Stream to local disk in full before anything reads it.

    Deliberately not lazy. The presigned URL is short-lived by design; a reader
    that issues range requests hours into a fit gets a 403 halfway through,
    which surfaces as a corrupt-looking read rather than an auth failure.

    Deliberately NOT the RunApi session: that carries the run token, and
    S3/MinIO reject a request presenting both query-string auth and an
    Authorization header. The upload path below uses bare `requests` for exactly
    this reason — the asymmetry was the bug, not the design, which is why both
    directions now live in this one module where the shared reason is stated
    once.
    """
    with requests.get(url, stream=True, timeout=300) as response:
        response.raise_for_status()
        with dest.open("wb") as handle:
            for chunk in response.iter_content(chunk_size=1024 * 1024):
                handle.write(chunk)
    return dest


def sha256_of(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def download_verified(
    url: str, dest: Path, expected_checksum: str, label: str
) -> tuple[Path, str]:
    """Download, then refuse anything that is not the bytes this run was
    created against. Returns (path, actual_checksum) — the checksum is returned
    rather than merely checked because run_manifest.json records it.

    `label` names WHICH artifact failed ("Artifact", "Holdout", "Model"): the
    original file wrote three near-identical mismatch messages, and a fourth
    caller would have written a fourth.
    """
    path = download(url, dest)
    actual = sha256_of(path)
    if actual != expected_checksum:
        raise RuntimeError(
            f"{label} checksum mismatch: expected {expected_checksum}, got "
            f"{actual}. The bytes are not the artifact this run was created "
            "against."
        )
    return path, actual


def upload_artifacts(
    api: RunApi,
    outputs: Mapping[str, tuple[Path, str]],
    log_fn: LogFn | None = None,
) -> list[str]:
    """Mint write URLs for exactly these filenames, then PUT each one.

    `outputs` maps filename -> (local path, content type). One implementation
    for both modes: the endpoint difference is already resolved inside
    `RunApi.upload_urls`, so there is nothing mode-specific left here.
    """
    upload_urls = api.upload_urls(list(outputs))

    uploaded: list[str] = []
    for filename, (path, content_type) in outputs.items():
        with path.open("rb") as handle:
            response = requests.put(
                upload_urls[filename],
                data=handle,
                headers={"Content-Type": content_type},
                timeout=600,
            )
        response.raise_for_status()
        uploaded.append(filename)

    if log_fn:
        log_fn(f"Uploaded {len(uploaded)} objects")
    return uploaded
