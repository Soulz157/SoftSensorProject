"""Azure Blob Storage backend. AZURE-BLOB-001.

No account key exists in the application. The service authenticates with
Microsoft Entra ID (managed identity in Azure, `az login` locally) and hands
containers user delegation SAS URLs, each limited to one blob. That keeps the
rule `ObjectStore` states for itself: only this service holds storage access.

The connection-string path exists for Azurite in tests. Bicep turns Shared Key
off on real accounts, so it cannot be used against them.

Tags are blob index tags because the lifecycle rule in `infra/` filters on them.
The account must keep a flat namespace: with hierarchical namespace on, tags do
not drive lifecycle management. Setting tags needs Storage Blob Data Owner;
Contributor is not enough.
"""

from __future__ import annotations

import logging
import threading
import time
from collections.abc import Callable, Iterator
from datetime import datetime, timedelta, timezone
from functools import wraps
from typing import IO, ParamSpec, TypeVar

from azure.core.exceptions import (
    AzureError,
    ResourceExistsError,
    ResourceNotFoundError,
)
from azure.storage.blob import (
    BlobSasPermissions,
    BlobServiceClient,
    ContentSettings,
    StorageStreamDownloader,
    UserDelegationKey,
    generate_blob_sas,
)

from config import settings
from intergrations.storage_backends import ReadHandle, StorageError

logger = logging.getLogger(__name__)

P = ParamSpec("P")
R = TypeVar("R")

#: Signed slightly in the past so clock skew cannot make a fresh URL invalid.
CLOCK_SKEW = timedelta(minutes=5)
#: How long a delegation key is requested for. Azure allows up to seven days;
#: a key is only reused to sign short-lived URLs, so hours are plenty.
DELEGATION_KEY_LIFETIME = timedelta(hours=6)
COPY_TIMEOUT_SECONDS = 300.0
COPY_POLL_SECONDS = 0.5


def _code_of(err: AzureError) -> str:
    """The store's error code, S3-style for a missing blob."""
    raw = getattr(err, "error_code", None)
    code = getattr(raw, "value", raw)
    if code == "BlobNotFound" or (
        code is None and isinstance(err, ResourceNotFoundError)
    ):
        return "NoSuchKey"
    return str(code or type(err).__name__)


def _translating(call: Callable[P, R]) -> Callable[P, R]:
    @wraps(call)
    def wrapper(*args: P.args, **kwargs: P.kwargs) -> R:
        try:
            return call(*args, **kwargs)
        except AzureError as err:
            raise StorageError(_code_of(err)) from err

    return wrapper


class _AzureReadHandle:
    def __init__(self, downloader: StorageStreamDownloader) -> None:
        self._downloader = downloader

    @_translating
    def read(self) -> bytes:
        return self._downloader.readall()

    def stream(self, chunk_bytes: int) -> Iterator[bytes]:
        try:
            while chunk := self._downloader.read(chunk_bytes):
                yield chunk
        except AzureError as err:
            raise StorageError(_code_of(err)) from err

    def close(self) -> None:
        """Nothing to release: the SDK owns the connection."""

    def release_conn(self) -> None:
        """Nothing to release: the SDK owns the connection."""


class AzureBlobBackend:
    def __init__(
        self,
        service: BlobServiceClient,
        container: str,
        account_key: str | None = None,
        sleep: Callable[[float], None] = time.sleep,
    ) -> None:
        self.container = container
        self._service = service
        self._account_key = account_key
        self._sleep = sleep
        self._container_client = service.get_container_client(container)
        self._delegation_key: UserDelegationKey | None = None
        self._delegation_key_expiry: datetime | None = None
        self._delegation_key_lock = threading.Lock()

    @classmethod
    def from_settings(cls, container: str | None = None) -> AzureBlobBackend:
        name = container or settings.AZURE_STORAGE_CONTAINER
        if settings.AZURE_STORAGE_CONNECTION_STRING:
            return cls.from_connection_string(
                settings.AZURE_STORAGE_CONNECTION_STRING, name
            )
        if not settings.AZURE_STORAGE_ACCOUNT_URL:
            raise StorageError(
                "ConfigurationError",
                "STORAGE_BACKEND=azure needs AZURE_STORAGE_ACCOUNT_URL.",
            )
        from azure.identity import DefaultAzureCredential

        return cls(
            BlobServiceClient(
                settings.AZURE_STORAGE_ACCOUNT_URL,
                credential=DefaultAzureCredential(),
            ),
            name,
        )

    @classmethod
    def from_connection_string(
        cls, connection_string: str, container: str
    ) -> AzureBlobBackend:
        service = BlobServiceClient.from_connection_string(connection_string)
        return cls(service, container, account_key=service.credential.account_key)

    def _blob(self, key: str):
        return self._container_client.get_blob_client(key)

    @_translating
    def ensure_container(self) -> None:
        try:
            self._container_client.create_container()
        except ResourceExistsError:
            pass

    def exists(self, key: str) -> bool:
        try:
            return bool(self._blob(key).exists())
        except AzureError:
            return False

    @_translating
    def put(
        self,
        key: str,
        stream: IO[bytes],
        length: int,
        content_type: str,
        tags: dict[str, str],
    ) -> None:
        self._blob(key).upload_blob(
            stream,
            length=length,
            overwrite=True,
            content_settings=ContentSettings(content_type=content_type),
            tags=tags or None,
        )

    @_translating
    def open_read(self, key: str) -> ReadHandle:
        return _AzureReadHandle(self._blob(key).download_blob())

    def list_keys(self, prefix: str) -> Iterator[str]:
        try:
            yield from self._container_client.list_blob_names(
                name_starts_with=prefix
            )
        except AzureError as err:
            raise StorageError(_code_of(err)) from err

    @_translating
    def delete(self, key: str) -> None:
        try:
            self._blob(key).delete_blob(delete_snapshots="include")
        except ResourceNotFoundError:
            pass  # S3 delete is idempotent, and `delete_prefix` relies on it.

    @_translating
    def copy(self, src_key: str, dst_key: str) -> None:
        """Server-side copy, waited on so the caller can tag the result.

        The copy is asynchronous by contract. Same-account copies usually
        finish at once, but returning early would let `copy_prefix` report a
        destination that does not exist yet.
        """
        destination = self._blob(dst_key)
        destination.start_copy_from_url(self._blob(src_key).url)
        deadline = time.monotonic() + COPY_TIMEOUT_SECONDS
        while True:
            status = destination.get_blob_properties().copy.status
            if status == "success":
                return
            if status != "pending":
                raise StorageError(f"CopyStatus{status}")
            if time.monotonic() > deadline:
                raise StorageError("CopyTimeout")
            self._sleep(COPY_POLL_SECONDS)

    @_translating
    def get_tags(self, key: str) -> dict[str, str]:
        return dict(self._blob(key).get_blob_tags())

    @_translating
    def set_tags(self, key: str, tags: dict[str, str]) -> None:
        self._blob(key).set_blob_tags(tags)

    def _signing_key(self, now: datetime, ttl: timedelta) -> UserDelegationKey:
        """A delegation key that outlives a URL expiring after `ttl`.

        Cached because each one is a round trip to the service and URLs are
        minted for every file of every run. Locked because FastAPI serves this
        from a thread pool.
        """
        needed_until = now + ttl + CLOCK_SKEW
        with self._delegation_key_lock:
            if (
                self._delegation_key is None
                or self._delegation_key_expiry is None
                or self._delegation_key_expiry < needed_until
            ):
                expiry = now + max(DELEGATION_KEY_LIFETIME, ttl + timedelta(hours=1))
                self._delegation_key = self._service.get_user_delegation_key(
                    now - CLOCK_SKEW, expiry
                )
                self._delegation_key_expiry = expiry
            return self._delegation_key

    @_translating
    def _sas_url(
        self, key: str, permission: BlobSasPermissions, ttl: timedelta
    ) -> str:
        now = datetime.now(timezone.utc)
        blob = self._blob(key)
        signer = (
            {"account_key": self._account_key}
            if self._account_key
            else {"user_delegation_key": self._signing_key(now, ttl)}
        )
        sas = generate_blob_sas(
            account_name=self._service.account_name,
            container_name=self.container,
            blob_name=key,
            permission=permission,
            start=now - CLOCK_SKEW,
            expiry=now + ttl,
            # Azurite serves plain HTTP; every real account is HTTPS.
            protocol="https" if blob.url.startswith("https://") else None,
            **signer,
        )
        return f"{blob.url}?{sas}"

    def presign_get(self, key: str, ttl: timedelta) -> str:
        return self._sas_url(key, BlobSasPermissions(read=True), ttl)

    def presign_put(self, key: str, ttl: timedelta) -> str:
        return self._sas_url(key, BlobSasPermissions(create=True, write=True), ttl)

    def ensure_tmp_lifecycle(
        self, rule_id: str, tag_key: str, tag_value: str, days: int
    ) -> None:
        """Declared in `infra/modules/storage.bicep`, not set at runtime.

        Lifecycle policy is account configuration, and the service identity
        only has data-plane access.
        """
        logger.info(
            "Lifecycle rule '%s' is managed by Bicep on Azure; nothing to do.",
            rule_id,
        )
