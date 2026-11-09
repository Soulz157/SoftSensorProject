"""AZURE-BLOB-001. What Azurite cannot prove: Entra-signed URLs and the
delegation key's lifetime, error mapping, and copy polling."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import MagicMock
from urllib.parse import parse_qs, urlparse

import pytest
from azure.core.exceptions import (
    HttpResponseError,
    ResourceExistsError,
    ResourceNotFoundError,
)
from azure.storage.blob import UserDelegationKey

from intergrations.azure_blob_backend import AzureBlobBackend
from intergrations.storage_backends import StorageError


def delegation_key() -> UserDelegationKey:
    key = UserDelegationKey()
    key.signed_oid = "oid"
    key.signed_tid = "tid"
    key.signed_start = "2026-11-09T00:00:00Z"
    key.signed_expiry = "2026-11-09T06:00:00Z"
    key.signed_service = "b"
    key.signed_version = "2025-07-05"
    key.value = "c2VjcmV0"
    return key


def make_backend(account_key: str | None = None):
    service = MagicMock()
    service.account_name = "acct"
    service.get_user_delegation_key.return_value = delegation_key()
    blob = MagicMock()
    blob.url = "https://acct.blob.core.windows.net/datasets/a%3Db/m.bin"
    container = service.get_container_client.return_value
    container.get_blob_client.return_value = blob
    backend = AzureBlobBackend(
        service, "datasets", account_key=account_key, sleep=lambda _: None
    )
    return backend, service, container, blob


def query(url: str) -> dict[str, list[str]]:
    return parse_qs(urlparse(url).query)


def test_write_url_grants_create_and_write_on_one_blob_only() -> None:
    backend, *_ = make_backend()

    q = query(backend.presign_put("a=b/m.bin", timedelta(minutes=30)))

    assert q["sp"] == ["cw"]
    assert q["sr"] == ["b"]
    assert q["spr"] == ["https"]
    assert "skoid" in q  # signed by a delegation key, not an account key


def test_read_url_grants_read_only() -> None:
    backend, *_ = make_backend()

    assert query(backend.presign_get("k", timedelta(minutes=15)))["sp"] == ["r"]


def test_url_expires_after_the_ttl_and_starts_in_the_past() -> None:
    backend, *_ = make_backend()
    before = datetime.now(timezone.utc)

    q = query(backend.presign_get("k", timedelta(minutes=15)))

    start = datetime.fromisoformat(q["st"][0].replace("Z", "+00:00"))
    expiry = datetime.fromisoformat(q["se"][0].replace("Z", "+00:00"))
    assert start < before
    assert timedelta(minutes=14) < expiry - before <= timedelta(minutes=16)


def test_delegation_key_is_reused_while_it_outlives_the_url() -> None:
    backend, service, *_ = make_backend()

    backend.presign_get("a", timedelta(minutes=15))
    backend.presign_put("b", timedelta(minutes=30))

    assert service.get_user_delegation_key.call_count == 1


def test_delegation_key_is_replaced_before_it_can_expire_under_a_url() -> None:
    backend, service, *_ = make_backend()
    backend.presign_get("a", timedelta(minutes=15))
    backend._delegation_key_expiry = datetime.now(timezone.utc) + timedelta(
        minutes=10
    )

    backend.presign_get("b", timedelta(minutes=15))

    assert service.get_user_delegation_key.call_count == 2


def test_delegation_key_always_covers_a_long_ttl() -> None:
    backend, service, *_ = make_backend()

    backend.presign_get("a", timedelta(hours=12))

    start, expiry = service.get_user_delegation_key.call_args.args
    assert expiry - start >= timedelta(hours=12)


def test_a_missing_blob_reads_as_no_such_key() -> None:
    backend, _, _, blob = make_backend()
    err = ResourceNotFoundError("gone")
    err.error_code = "BlobNotFound"
    blob.download_blob.side_effect = err

    with pytest.raises(StorageError) as caught:
        backend.open_read("k")

    assert caught.value.code == "NoSuchKey"


def test_a_missing_container_is_not_reported_as_a_missing_blob() -> None:
    backend, _, _, blob = make_backend()
    err = ResourceNotFoundError("no container")
    err.error_code = "ContainerNotFound"
    blob.download_blob.side_effect = err

    with pytest.raises(StorageError) as caught:
        backend.open_read("k")

    assert caught.value.code == "ContainerNotFound"


def test_a_permission_failure_keeps_its_code() -> None:
    backend, _, _, blob = make_backend()
    err = HttpResponseError("denied")
    err.error_code = "AuthorizationPermissionMismatch"
    blob.set_blob_tags.side_effect = err

    with pytest.raises(StorageError) as caught:
        backend.set_tags("k", {"retention": "referenced"})

    assert caught.value.code == "AuthorizationPermissionMismatch"


def copy_props(*statuses: str) -> list[SimpleNamespace]:
    return [SimpleNamespace(copy=SimpleNamespace(status=s)) for s in statuses]


def test_copy_waits_until_the_blob_has_arrived() -> None:
    backend, _, _, blob = make_backend()
    blob.get_blob_properties.side_effect = copy_props("pending", "success")

    backend.copy("src", "dst")

    assert blob.get_blob_properties.call_count == 2


def test_a_failed_copy_raises() -> None:
    backend, _, _, blob = make_backend()
    blob.get_blob_properties.side_effect = copy_props("failed")

    with pytest.raises(StorageError):
        backend.copy("src", "dst")


def test_deleting_a_missing_blob_is_not_an_error() -> None:
    backend, _, _, blob = make_backend()
    blob.delete_blob.side_effect = ResourceNotFoundError("gone")

    backend.delete("k")


def test_an_existing_container_is_fine() -> None:
    backend, _, container, _ = make_backend()
    container.create_container.side_effect = ResourceExistsError("there")

    backend.ensure_container()


def test_no_tags_are_sent_as_none() -> None:
    backend, _, _, blob = make_backend()

    backend.put("k", MagicMock(), 3, "text/plain", {})

    assert blob.upload_blob.call_args.kwargs["tags"] is None


def test_lifecycle_is_left_to_bicep() -> None:
    backend, service, container, _ = make_backend()

    backend.ensure_tmp_lifecycle("rule", "lifecycle", "tmp", 7)

    assert not service.set_service_properties.called
    assert not container.method_calls


def test_azure_needs_an_account_url(monkeypatch: pytest.MonkeyPatch) -> None:
    from intergrations import azure_blob_backend as module

    monkeypatch.setattr(module.settings, "AZURE_STORAGE_ACCOUNT_URL", "")
    monkeypatch.setattr(module.settings, "AZURE_STORAGE_CONNECTION_STRING", "")

    with pytest.raises(StorageError, match="AZURE_STORAGE_ACCOUNT_URL"):
        AzureBlobBackend.from_settings()
