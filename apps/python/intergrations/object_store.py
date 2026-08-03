"""MinIO / S3 object storage for dataset version artifacts.

Note the package spelling: `intergrations` is the existing (misspelled) package
name used throughout this service. Kept deliberately — a parallel, correctly
spelled package would be worse than one consistent typo.

Artifact layout
---------------
    datasets/{datasetId}/{versionId}.parquet        committed, IMMUTABLE
    datasets/{datasetId}/tmp/{jobId}/{n}.parquet    per-op intermediates

Frame layout (the canonical value+status shape)
-----------------------------------------------
    timestamp        timestamp[ns], naive Bangkok local
    {tag}            double
    {tag}__status    int8   0=Good, 1=Bad, 2=Questionable

Status travels alongside the values because the cleaning operations depend on
it: `drop` removes rows whose cell is not Good, and mean/median fills average
Good cells only. A plain value frame would lose that and silently change results.
"""

from __future__ import annotations

import io
from dataclasses import dataclass
from typing import Any

import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq
from minio import Minio
from minio.error import S3Error

from config import settings

# Suffix reserved for the status sidecar column. A real tag named `FOO__status`
# would collide with `FOO`'s status column and silently corrupt it, so writes
# reject it rather than trusting that PI never produces such a name.
STATUS_SUFFIX = "__status"

TIMESTAMP_COLUMN = "timestamp"

STATUS_GOOD = 0
STATUS_BAD = 1
STATUS_QUESTIONABLE = 2


class ObjectStoreError(RuntimeError):
    """Storage failure with a message safe to surface to the caller."""


@dataclass(frozen=True)
class ArtifactStats:
    """What NestJS records on the DatasetVersion row after a write.

    Snake_case here and on the wire (`schemas.preprocess.ArtifactStatsResponse`),
    like every other endpoint in this service; NestJS maps to its camelCase
    columns on its side. An earlier `as_dict()` emitted a camelCase twin of this
    exact shape and had no callers — removed rather than left to drift, because
    two spellings of one payload is how the two sides end up disagreeing.
    """

    object_key: str
    row_count: int
    column_count: int
    size_bytes: int
    missing_pct: float


def tag_columns(df: pd.DataFrame) -> list[str]:
    """Logical tags only — excludes `timestamp` and every status sidecar.

    `columnCount` on DatasetVersion and the preview's "feature count" must both
    use this definition or they disagree on screen: the frame carries 2N+1
    physical columns for N logical tags.
    """
    return [
        c for c in df.columns if c != TIMESTAMP_COLUMN and not c.endswith(STATUS_SUFFIX)
    ]


def status_column(tag: str) -> str:
    return f"{tag}{STATUS_SUFFIX}"


def assert_tags_are_storable(tags: list[str]) -> None:
    """Reject tag names that would collide with the status sidecar.

    Call this with the SOURCE tag list (what PI/SQL returned), before the frame
    is built. Passing `tag_columns(df)` here is useless: that helper already
    strips anything ending in the suffix, so an offending tag would have been
    filtered out before the check ever saw it.
    """
    offenders = [t for t in tags if t.endswith(STATUS_SUFFIX)]
    if offenders:
        raise ValueError(
            f"Tag names ending in '{STATUS_SUFFIX}' are reserved and would "
            f"overwrite another tag's quality column: {sorted(offenders)}. "
            "Rename the tag before creating this dataset version."
        )


def assert_frame_shape(df: pd.DataFrame) -> None:
    """Validate the built frame, catching what a tag-name check cannot.

    A tag literally named `FOO__status` does not merely collide — it is
    classified as a status sidecar by `tag_columns` and silently disappears
    from the dataset. That is data loss with no error, so the structural
    invariant is enforced here on the frame itself:

      * every column is `timestamp`, a tag, or `{tag}__status` for a real tag
      * no duplicate column names
      * every tag has its status sidecar
    """
    if TIMESTAMP_COLUMN not in df.columns:
        raise ValueError(f"Frame is missing the '{TIMESTAMP_COLUMN}' column.")

    columns = [str(c) for c in df.columns]

    duplicates = sorted({c for c in columns if columns.count(c) > 1})
    if duplicates:
        raise ValueError(
            f"Duplicate column names in frame: {duplicates}. A tag named "
            f"'<name>{STATUS_SUFFIX}' collides with another tag's quality column."
        )

    tags = [c for c in columns if c != TIMESTAMP_COLUMN and not c.endswith(STATUS_SUFFIX)]
    status_cols = [c for c in columns if c.endswith(STATUS_SUFFIX)]

    orphans = [c for c in status_cols if c[: -len(STATUS_SUFFIX)] not in tags]
    if orphans:
        raise ValueError(
            f"Columns ending in '{STATUS_SUFFIX}' with no matching tag: "
            f"{sorted(orphans)}. Either the tag name is reserved, or the frame "
            "was built incorrectly."
        )

    missing_status = [t for t in tags if status_column(t) not in columns]
    if missing_status:
        raise ValueError(
            f"Tags with no quality column: {sorted(missing_status)}. Every tag "
            f"needs a '{STATUS_SUFFIX}' sidecar or cleaning operations that "
            "depend on status would silently treat the data as Good."
        )


def missing_pct(df: pd.DataFrame) -> float:
    """Share of tag cells that are not Good, as a percentage."""
    tags = tag_columns(df)
    if not tags or df.empty:
        return 0.0

    total = len(df) * len(tags)
    if not total:
        return 0.0

    non_good = 0
    for tag in tags:
        col = status_column(tag)
        if col in df.columns:
            non_good += int((df[col] != STATUS_GOOD).sum())
    return round(non_good / total * 100, 4)


class ObjectStore:
    """Thin Parquet-over-MinIO wrapper.

    Only this service holds S3 credentials. NestJS reaches artifacts through the
    Python API, which keeps one seam and one place to audit.
    """

    def __init__(
        self,
        endpoint: str | None = None,
        access_key: str | None = None,
        secret_key: str | None = None,
        bucket: str | None = None,
        region: str | None = None,
    ) -> None:
        raw_endpoint = endpoint or settings.S3_ENDPOINT
        secure = raw_endpoint.startswith("https://")
        host = raw_endpoint.split("://", 1)[-1].rstrip("/")

        self.bucket = bucket or settings.S3_BUCKET
        self._client = Minio(
            host,
            access_key=access_key or settings.S3_ACCESS_KEY,
            secret_key=secret_key or settings.S3_SECRET_KEY,
            region=region or settings.S3_REGION,
            secure=secure,
        )

    # ── bucket ───────────────────────────────────────────────────────────

    def ensure_bucket(self) -> None:
        try:
            if not self._client.bucket_exists(self.bucket):
                self._client.make_bucket(self.bucket)
        except S3Error as err:
            raise ObjectStoreError(
                f"Could not prepare bucket '{self.bucket}': {err.code}"
            ) from err

    def exists(self, key: str) -> bool:
        try:
            self._client.stat_object(self.bucket, key)
            return True
        except S3Error:
            return False

    # ── write ────────────────────────────────────────────────────────────

    def put_frame(
        self, df: pd.DataFrame, key: str, *, overwrite: bool = False
    ) -> ArtifactStats:
        """Write a frame as Parquet and return the stats NestJS persists.

        Committed versions are immutable: writing over an existing key is
        refused unless explicitly allowed (tmp/ intermediates on job retry).
        """
        assert_frame_shape(df)

        if not overwrite and self.exists(key):
            raise ObjectStoreError(
                f"Refusing to overwrite committed artifact '{key}'. "
                "Dataset versions are immutable — write a new version instead."
            )

        buffer = io.BytesIO()
        pq.write_table(pa.Table.from_pandas(df, preserve_index=False), buffer)
        payload = buffer.getvalue()

        try:
            self._client.put_object(
                self.bucket,
                key,
                io.BytesIO(payload),
                length=len(payload),
                content_type="application/vnd.apache.parquet",
            )
        except S3Error as err:
            raise ObjectStoreError(f"Could not write '{key}': {err.code}") from err

        return ArtifactStats(
            object_key=key,
            row_count=int(len(df)),
            column_count=len(tag_columns(df)),
            size_bytes=len(payload),
            missing_pct=missing_pct(df),
        )

    # ── read ─────────────────────────────────────────────────────────────

    def get_frame(self, key: str, columns: list[str] | None = None) -> pd.DataFrame:
        response = None
        try:
            response = self._client.get_object(self.bucket, key)
            table = pq.read_table(io.BytesIO(response.read()), columns=columns)
            return table.to_pandas()
        except S3Error as err:
            raise ObjectStoreError(f"Could not read '{key}': {err.code}") from err
        finally:
            if response is not None:
                response.close()
                response.release_conn()

    def get_frame_slice(
        self, key: str, offset: int = 0, limit: int = 1000
    ) -> pd.DataFrame:
        """Row window for client hydration.

        Reads the whole object then slices. Parquet is columnar, so true row
        pushdown needs row-group metadata; revisit if artifacts outgrow memory.
        """
        if offset < 0 or limit <= 0:
            raise ValueError("offset must be >= 0 and limit must be > 0")
        return self.get_frame(key).iloc[offset : offset + limit].reset_index(drop=True)

    def get_frame_head(self, key: str, limit: int) -> tuple[pd.DataFrame, int]:
        """Head window plus the artifact's TRUE row count.

        `get_frame_slice` discards the total, and the total is the only thing
        that can tell a caller whether the window it got back is the whole
        dataset or the first page of something much larger. The read is
        whole-object either way (see above), so returning it costs nothing.
        """
        if limit <= 0:
            raise ValueError("limit must be > 0")
        frame = self.get_frame(key)
        return frame.head(limit).reset_index(drop=True), int(len(frame))

    # ── delete ───────────────────────────────────────────────────────────

    def delete_prefix(self, prefix: str) -> int:
        """Drop every object under a prefix — used to clear tmp/{jobId}/."""
        removed = 0
        try:
            for obj in self._client.list_objects(
                self.bucket, prefix=prefix, recursive=True
            ):
                self._client.remove_object(self.bucket, obj.object_name)
                removed += 1
        except S3Error as err:
            raise ObjectStoreError(
                f"Could not clear prefix '{prefix}': {err.code}"
            ) from err
        return removed


# ── key helpers ──────────────────────────────────────────────────────────


def version_key(dataset_id: str, version_id: str) -> str:
    return f"{dataset_id}/{version_id}.parquet"


def tmp_key(dataset_id: str, job_id: str, step: int) -> str:
    return f"{dataset_id}/tmp/{job_id}/{step}.parquet"


def tmp_prefix(dataset_id: str, job_id: str) -> str:
    return f"{dataset_id}/tmp/{job_id}/"
