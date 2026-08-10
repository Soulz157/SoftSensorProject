"""MinIO / S3 object storage for dataset version artifacts.

Note the package spelling: `intergrations` is the existing (misspelled) package
name used throughout this service. Kept deliberately — a parallel, correctly
spelled package would be worse than one consistent typo.

Artifact layout
---------------
    datasets/{datasetId}/artifacts/{artifactId}/data.parquet       committed, IMMUTABLE
    datasets/{datasetId}/artifacts/{artifactId}/manifest.json      sidecar
    datasets/{datasetId}/artifacts/{artifactId}/feature_spec.json  GOLD only
    datasets/{datasetId}/artifacts/{artifactId}/validation_report.json  FINAL only
    datasets/{datasetId}/tmp/{jobId}/{n}.parquet                   per-op intermediates

    datasets/{datasetId}/{versionId}.parquet                       LEGACY, still read

`version_key` builds the legacy layout and is kept because artifacts written
before DS-LAKE-003 live there and are immutable — they cannot be moved. Nothing
writes that shape any more.

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

import hashlib
import io
import json
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

import pandas as pd
import pyarrow as pa
import pyarrow.compute as pc
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

#: Bumped when the physical frame layout changes in a way a reader must know
#: about. Recorded on every artifact so an old object stays interpretable.
SCHEMA_VERSION = 1

MANIFEST_FILENAME = "manifest.json"
FEATURE_SPEC_FILENAME = "feature_spec.json"
VALIDATION_REPORT_FILENAME = "validation_report.json"
#: DS-LAKE-005B-A-T07. Per-tag aggregate stats, written beside the data at
#: write time via the same `sidecar_key()` pattern as the manifest — a
#: reader derives this key from `source_key` alone, the same way `/metadata`
#: and `/tags` do, rather than needing a separately-stored location.
COLUMN_STATS_FILENAME = "column_stats.json"
DATA_FILENAME = "data.parquet"

#: Root prefix for imported soft-sensor feature presets. A prefix inside the
#: existing bucket rather than a bucket of its own: `ensure_bucket()` has no
#: runtime caller in this service, so a second bucket would need new bootstrap
#: while a prefix needs none.
PRESET_ROOT = "feature-presets/"
SDTA_FILENAME = "sdta.json"


class ObjectStoreError(RuntimeError):
    """Storage failure with a message safe to surface to the caller."""


@dataclass(frozen=True)
class ArtifactStats:
    """What NestJS records on the artifact row after a write.

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
    #: sha256 of the Parquet bytes exactly as stored. This is what makes
    #: immutability checkable rather than merely promised: the write refusal
    #: stops an overwrite, and this proves the bytes never changed anyway.
    checksum: str


def _tags_from_columns(columns: list[str]) -> list[str]:
    """Shared by `tag_columns` (has a DataFrame) and `get_frame_metadata`
    (has only Parquet schema names, no decoded columns) so the two never
    diverge on what counts as a tag.
    """
    return [
        c for c in columns if c != TIMESTAMP_COLUMN and not c.endswith(STATUS_SUFFIX)
    ]


def tag_columns(df: pd.DataFrame) -> list[str]:
    """Logical tags only — excludes `timestamp` and every status sidecar.

    `columnCount` on the artifact row and the preview's "feature count" must both
    use this definition or they disagree on screen: the frame carries 2N+1
    physical columns for N logical tags.
    """
    return _tags_from_columns(list(df.columns))


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


def sha256_hex(payload: bytes) -> str:
    """Checksum of the stored bytes.

    Deliberately hashes the SERIALISED Parquet, not the DataFrame: that is what
    actually lands in storage, so re-reading the object and re-hashing it
    reproduces this value. Hashing the frame instead would make the checksum
    depend on pandas internals and stop being verifiable against the object.
    """
    return hashlib.sha256(payload).hexdigest()


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
            checksum=sha256_hex(payload),
        )

    def put_json(self, key: str, document: Any, *, overwrite: bool = True) -> int:
        """Write a JSON sidecar (manifest, feature spec, validation report).

        Overwrites by default, unlike `put_frame`. Sidecars describe the data
        object rather than being it: a validation report may legitimately be
        rewritten for an artifact whose bytes never change. The DATA is what is
        immutable.
        """
        if not overwrite and self.exists(key):
            raise ObjectStoreError(f"Refusing to overwrite sidecar '{key}'.")

        payload = json.dumps(document, indent=2, sort_keys=True, default=str).encode()
        try:
            self._client.put_object(
                self.bucket,
                key,
                io.BytesIO(payload),
                length=len(payload),
                content_type="application/json",
            )
        except S3Error as err:
            raise ObjectStoreError(f"Could not write '{key}': {err.code}") from err
        return len(payload)

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

    def get_frame_metadata(self, key: str) -> dict[str, Any]:
        """Tag names and the timestamp range, without decoding tag or status
        columns.

        The tag list and row count come from the Parquet footer; only the
        `timestamp` column's data is actually decoded, and via `pyarrow.compute`
        rather than an assumption that the frame is sorted. An 8,000-tag
        artifact still costs one object download, but not 16,000 columns of
        decode — DS-LAKE-005B-A-T01's metadata endpoint is this call plus the
        counters already sitting on the artifact row, so it never opens
        `data.parquet` at all when only the DatasetArtifact row is served.

        `tags` is ALPHABETICAL, not schema/file-column order —
        DS-LAKE-005B-A-T03's `tag_catalog()` is built on this same call, and a
        client that indexes tags from `/metadata` then pages `/tags` must see
        one consistent order for the same names, not two.
        """
        response = None
        try:
            response = self._client.get_object(self.bucket, key)
            payload = response.read()
        except S3Error as err:
            raise ObjectStoreError(f"Could not read '{key}': {err.code}") from err
        finally:
            if response is not None:
                response.close()
                response.release_conn()

        buffer = io.BytesIO(payload)
        parquet_file = pq.ParquetFile(buffer)
        schema_names = list(parquet_file.schema_arrow.names)
        tags = sorted(_tags_from_columns(schema_names))
        row_count = int(parquet_file.metadata.num_rows)

        start_time: str | None = None
        end_time: str | None = None
        if row_count and TIMESTAMP_COLUMN in schema_names:
            column = pq.read_table(buffer, columns=[TIMESTAMP_COLUMN]).column(
                TIMESTAMP_COLUMN
            )
            lo = pc.min(column).as_py()
            hi = pc.max(column).as_py()
            start_time = lo.isoformat(sep=" ") if hasattr(lo, "isoformat") else str(lo)
            end_time = hi.isoformat(sep=" ") if hasattr(hi, "isoformat") else str(hi)

        return {
            "tags": tags,
            #: PHYSICAL width, measured from the same schema read as `tags` —
            #: `timestamp` + one column per tag + one `__status` sidecar per
            #: tag, i.e. 2N+1 for N logical tags. Deliberately the schema's own
            #: column count, not `2 * len(tags)`: a derived number can disagree
            #: with `tags` on a legacy or malformed row, a measured one cannot.
            "column_count": len(schema_names),
            "row_count": row_count,
            "start_time": start_time,
            "end_time": end_time,
        }

    def get_json(self, key: str) -> Any:
        response = None
        try:
            response = self._client.get_object(self.bucket, key)
            return json.loads(response.read())
        except S3Error as err:
            raise ObjectStoreError(f"Could not read '{key}': {err.code}") from err
        finally:
            if response is not None:
                response.close()
                response.release_conn()

    def checksum_of(self, key: str) -> str:
        """Re-hash a stored object.

        Lets a caller verify an artifact against its recorded checksum, and lets
        DS-LAKE-002's backfilled rows — which carry an empty checksum because
        they predate this field — acquire a real one without inventing anything.
        """
        response = None
        try:
            response = self._client.get_object(self.bucket, key)
            return sha256_hex(response.read())
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

    # `get_frame_head` (head window + true row count) was removed in
    # DS-LAKE-005B-A-T04: its one caller, `preview_service.build_preview`,
    # needed column projection and a time filter applied BEFORE the head cap,
    # neither of which this method took, so the head/count logic moved
    # in-line there (mirroring `artifact_service.rows`) instead of growing a
    # third parameter set here.

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
#
# These are mirrored in TypeScript at apps/backend/src/lib/artifact-keys.ts.
# Before DS-LAKE-003 the backend rebuilt the same strings inline in three
# places, so a layout change had four independent chances to be missed. Change
# both files together.


def artifact_prefix(dataset_id: str, artifact_id: str) -> str:
    return f"{dataset_id}/artifacts/{artifact_id}/"


def artifact_key(dataset_id: str, artifact_id: str) -> str:
    return f"{artifact_prefix(dataset_id, artifact_id)}{DATA_FILENAME}"


def manifest_key(dataset_id: str, artifact_id: str) -> str:
    return f"{artifact_prefix(dataset_id, artifact_id)}{MANIFEST_FILENAME}"


def feature_spec_key(dataset_id: str, artifact_id: str) -> str:
    return f"{artifact_prefix(dataset_id, artifact_id)}{FEATURE_SPEC_FILENAME}"


def validation_key(dataset_id: str, artifact_id: str) -> str:
    return f"{artifact_prefix(dataset_id, artifact_id)}{VALIDATION_REPORT_FILENAME}"


def sidecar_key(data_key: str, filename: str) -> str:
    """Sidecar beside an arbitrary data key.

    Needed because the writer is handed a `target_key` and does not always know
    the dataset/artifact ids that produced it. Falls back to appending a suffix
    when the key is not in the artifact layout, so a legacy or tmp key still
    gets a manifest instead of silently getting none.
    """
    if data_key.endswith(f"/{DATA_FILENAME}"):
        return data_key[: -len(DATA_FILENAME)] + filename
    return f"{data_key}.{filename}"


def preset_import_prefix(workspace_id: str, import_id: str) -> str:
    """Where one workbook import's documents live.

    Presets are workspace-scoped rather than dataset-scoped: a preset is imported
    before any dataset exists and is reused across many of them, so it cannot
    hang off a dataset id like every key above it. The import id groups one
    upload, which is what makes a re-upload a NEW set of documents rather than a
    mutation of the previous one.
    """
    return f"{PRESET_ROOT}{workspace_id}/{import_id}/"


def preset_key(prefix: str, preset_id: str) -> str:
    return f"{prefix}{preset_id}.json"


def sdta_key(prefix: str) -> str:
    return f"{prefix}{SDTA_FILENAME}"


def version_key(dataset_id: str, version_id: str) -> str:
    """LEGACY layout. Read-only — artifacts written before DS-LAKE-003."""
    return f"{dataset_id}/{version_id}.parquet"


def tmp_key(dataset_id: str, job_id: str, step: int) -> str:
    return f"{dataset_id}/tmp/{job_id}/{step}.parquet"


def tmp_prefix(dataset_id: str, job_id: str) -> str:
    return f"{dataset_id}/tmp/{job_id}/"


# ── manifest ─────────────────────────────────────────────────────────────


def build_manifest(
    stats: ArtifactStats,
    *,
    artifact_type: str | None = None,
    parent_key: str | None = None,
    operations: Any = None,
    duration_ms: int | None = None,
) -> dict[str, Any]:
    """The self-describing record written beside every data object.

    Exists so an artifact is interpretable from object storage ALONE. Postgres
    holds the same facts, but the refactor's own success criterion is that a
    dataset is reproducible from MinIO without it.

    `artifact_type` and `parent_key` are optional because the writer does not
    learn them until DS-LAKE-004 threads them through the request. Null here
    means "not recorded", which is honest; inventing BRONZE for every write
    would be worse than an absent field.
    """
    return {
        "object_key": stats.object_key,
        "checksum": stats.checksum,
        "format": "parquet",
        "schema_version": SCHEMA_VERSION,
        "row_count": stats.row_count,
        "column_count": stats.column_count,
        "missing_pct": stats.missing_pct,
        "size_bytes": stats.size_bytes,
        "artifact_type": artifact_type,
        "parent_key": parent_key,
        "operations": operations if operations is not None else [],
        "duration_ms": duration_ms,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
