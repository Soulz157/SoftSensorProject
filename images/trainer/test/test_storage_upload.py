"""AZURE-BLOB-001. Azure Blob rejects a presigned PUT without the blob type."""

from __future__ import annotations

from pathlib import Path
from unittest.mock import MagicMock

import storage


def test_every_upload_declares_a_block_blob(tmp_path: Path, monkeypatch) -> None:
    artifact = tmp_path / "model.joblib"
    artifact.write_bytes(b"model")
    api = MagicMock()
    api.upload_urls.return_value = {"model.joblib": "https://store/url"}
    put = MagicMock()
    monkeypatch.setattr(storage.requests, "put", put)

    uploaded = storage.upload_artifacts(
        api, {"model.joblib": (artifact, "application/octet-stream")}
    )

    assert uploaded == ["model.joblib"]
    assert put.call_args.kwargs["headers"] == {
        "Content-Type": "application/octet-stream",
        "x-ms-blob-type": "BlockBlob",
    }
