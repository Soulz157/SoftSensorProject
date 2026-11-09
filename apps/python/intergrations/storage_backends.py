"""The object-store operations `ObjectStore` needs, behind one interface.

AZURE-BLOB-001. `ObjectStore` owns Parquet, key layout and retention. This
module owns only "talk to the store", so production can run on Azure Blob while
local development keeps MinIO.

Every backend raises `StorageError` with an S3-style `code`, `NoSuchKey` for a
missing object. `ObjectStore` builds its messages from that code, so callers see
the same text whichever store is underneath.

The Azure backend lives in `azure_blob_backend.py` and is imported only when
selected, for the same reason `intergrations/__init__.py` does not import this
package: a machine using MinIO should not need the Azure SDK to start.
"""

from __future__ import annotations

import logging
from collections.abc import Iterator
from datetime import timedelta
from typing import IO, Protocol

from minio import Minio
from minio.commonconfig import ENABLED, CopySource, Filter, Tag
from minio.datatypes import Tags
from minio.error import S3Error
from minio.lifecycleconfig import Expiration, LifecycleConfig, Rule

from config import settings

logger = logging.getLogger(__name__)


class StorageError(Exception):
    """A store refused or failed an operation.

    `detail` overrides the message `ObjectStore` would otherwise build, for the
    few operations whose text is specific to one backend.
    """

    def __init__(self, code: str, detail: str | None = None) -> None:
        super().__init__(detail or code)
        self.code = code
        self.detail = detail


class ReadHandle(Protocol):
    """An open object. The caller always calls `close` and `release_conn`."""

    def read(self) -> bytes: ...

    def stream(self, chunk_bytes: int) -> Iterator[bytes]: ...

    def close(self) -> None: ...

    def release_conn(self) -> None: ...


class StorageBackend(Protocol):
    container: str

    def ensure_container(self) -> None: ...

    def exists(self, key: str) -> bool: ...

    def put(
        self,
        key: str,
        stream: IO[bytes],
        length: int,
        content_type: str,
        tags: dict[str, str],
    ) -> None: ...

    def open_read(self, key: str) -> ReadHandle: ...

    def list_keys(self, prefix: str) -> Iterator[str]: ...

    def delete(self, key: str) -> None: ...

    def copy(self, src_key: str, dst_key: str) -> None: ...

    def get_tags(self, key: str) -> dict[str, str]: ...

    def set_tags(self, key: str, tags: dict[str, str]) -> None: ...

    def presign_get(self, key: str, ttl: timedelta) -> str: ...

    def presign_put(self, key: str, ttl: timedelta) -> str: ...

    def ensure_tmp_lifecycle(
        self, rule_id: str, tag_key: str, tag_value: str, days: int
    ) -> None: ...


def _s3(err: S3Error) -> StorageError:
    return StorageError(err.code or "S3Error")


class MinioBackend:
    """MinIO, or anything else speaking S3."""

    def __init__(
        self,
        endpoint: str,
        access_key: str,
        secret_key: str,
        bucket: str,
        region: str,
        public_endpoint: str | None = None,
    ) -> None:
        self.container = bucket
        self._access_key = access_key
        self._secret_key = secret_key
        self._region = region
        self._public_endpoint = public_endpoint or endpoint
        self._presign_minio: Minio | None = None
        self.client = self._connect(endpoint)

    def _connect(self, endpoint: str) -> Minio:
        return Minio(
            endpoint.split("://", 1)[-1].rstrip("/"),
            access_key=self._access_key,
            secret_key=self._secret_key,
            region=self._region,
            secure=endpoint.startswith("https://"),
        )

    def ensure_container(self) -> None:
        try:
            if not self.client.bucket_exists(self.container):
                self.client.make_bucket(self.container)
        except S3Error as err:
            raise _s3(err) from err

    def exists(self, key: str) -> bool:
        try:
            self.client.stat_object(self.container, key)
            return True
        except S3Error:
            return False

    def put(
        self,
        key: str,
        stream: IO[bytes],
        length: int,
        content_type: str,
        tags: dict[str, str],
    ) -> None:
        object_tags = Tags.new_object_tags()
        object_tags.update(tags)
        try:
            self.client.put_object(
                self.container,
                key,
                stream,
                length=length,
                content_type=content_type,
                tags=object_tags,
            )
        except S3Error as err:
            raise _s3(err) from err

    def open_read(self, key: str) -> ReadHandle:
        try:
            return self.client.get_object(self.container, key)
        except S3Error as err:
            raise _s3(err) from err

    def list_keys(self, prefix: str) -> Iterator[str]:
        try:
            for obj in self.client.list_objects(
                self.container, prefix=prefix, recursive=True
            ):
                yield obj.object_name
        except S3Error as err:
            raise _s3(err) from err

    def delete(self, key: str) -> None:
        try:
            self.client.remove_object(self.container, key)
        except S3Error as err:
            raise _s3(err) from err

    def copy(self, src_key: str, dst_key: str) -> None:
        try:
            self.client.copy_object(
                self.container, dst_key, CopySource(self.container, src_key)
            )
        except S3Error as err:
            raise _s3(err) from err

    def get_tags(self, key: str) -> dict[str, str]:
        try:
            return dict(self.client.get_object_tags(self.container, key) or {})
        except S3Error as err:
            raise _s3(err) from err

    def set_tags(self, key: str, tags: dict[str, str]) -> None:
        object_tags = Tags.new_object_tags()
        object_tags.update(tags)
        try:
            self.client.set_object_tags(self.container, key, object_tags)
        except S3Error as err:
            raise _s3(err) from err

    def _presign_client(self) -> Minio:
        """Client bound to the endpoint a container can reach.

        SigV4 signs the Host header, so the hostname is baked into the
        signature and cannot be rewritten afterwards. `S3_ENDPOINT` is what
        this service dials, and a training container on another network cannot
        resolve it; `S3_PUBLIC_ENDPOINT` is the name the container must use.
        """
        if self._presign_minio is None:
            self._presign_minio = self._connect(self._public_endpoint)
        return self._presign_minio

    def _presign(self, method: str, key: str, ttl: timedelta) -> str:
        try:
            return self._presign_client().get_presigned_url(
                method, self.container, key, expires=ttl
            )
        except S3Error as err:
            raise _s3(err) from err

    def presign_get(self, key: str, ttl: timedelta) -> str:
        return self._presign("GET", key, ttl)

    def presign_put(self, key: str, ttl: timedelta) -> str:
        return self._presign("PUT", key, ttl)

    def ensure_tmp_lifecycle(
        self, rule_id: str, tag_key: str, tag_value: str, days: int
    ) -> None:
        desired = Rule(
            ENABLED,
            rule_id=rule_id,
            rule_filter=Filter(tag=Tag(tag_key, tag_value)),
            expiration=Expiration(days=days),
        )

        try:
            existing = self.client.get_bucket_lifecycle(self.container)
        except S3Error as err:
            # NoSuchLifecycleConfiguration means "none set yet" — not a
            # failure to surface.
            if err.code != "NoSuchLifecycleConfiguration":
                raise StorageError(
                    err.code or "S3Error",
                    f"Could not read lifecycle config for '{self.container}': "
                    f"{err.code}",
                ) from err
            existing = None

        rules = existing.rules if existing else []
        other_rules = [rule for rule in rules if rule.rule_id != rule_id]
        current = next((rule for rule in rules if rule.rule_id == rule_id), None)
        if current == desired:
            return  # already in the desired state — no-op, no API call

        try:
            self.client.set_bucket_lifecycle(
                self.container, LifecycleConfig([*other_rules, desired])
            )
        except S3Error as err:
            raise StorageError(
                err.code or "S3Error",
                f"Could not set lifecycle rule on '{self.container}': {err.code}",
            ) from err


def build_backend(
    endpoint: str | None = None,
    access_key: str | None = None,
    secret_key: str | None = None,
    bucket: str | None = None,
    region: str | None = None,
) -> StorageBackend:
    """The backend `STORAGE_BACKEND` selects."""
    if settings.STORAGE_BACKEND == "azure":
        from intergrations.azure_blob_backend import AzureBlobBackend

        return AzureBlobBackend.from_settings(container=bucket)

    return MinioBackend(
        endpoint=endpoint or settings.S3_ENDPOINT,
        access_key=access_key or settings.S3_ACCESS_KEY,
        secret_key=secret_key or settings.S3_SECRET_KEY,
        bucket=bucket or settings.S3_BUCKET,
        region=region or settings.S3_REGION,
        public_endpoint=getattr(settings, "S3_PUBLIC_ENDPOINT", None),
    )
