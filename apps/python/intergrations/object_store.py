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
from datetime import datetime, timedelta, timezone
import hashlib
import io
import json
import logging
import os
import tempfile
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import IO, Any

import duckdb
import pandas as pd
import pyarrow as pa
import pyarrow.compute as pc
import pyarrow.parquet as pq
from minio import Minio
from minio.commonconfig import ENABLED, CopySource, Filter, Tag
from minio.datatypes import Tags
from minio.error import S3Error
from minio.lifecycleconfig import Expiration, LifecycleConfig, Rule

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
#: DS-LAKE-018-T03. The raw validation-holdout sidecar, written beside a
#: BRONZE's own data key via `sidecar_key()` — works for both the legacy
#: `data.parquet` and DS-LAKE-016's stage-suffixed `data_bronze.parquet`,
#: same as every other sidecar. Mirrored in artifact-keys.ts as
#: `VALIDATE_DATA_FILENAME` — change both.
VALIDATE_DATA_FILENAME = "validate_data.parquet"

#: DS-LAKE-021-T01. The CSV export sidecar, written beside a committed
#: artifact's data key via `sidecar_key()` — same mechanism as
#: VALIDATE_DATA_FILENAME above. Mirrored in artifact-keys.ts as
#: `EXPORT_CSV_FILENAME` — change both.
EXPORT_CSV_FILENAME = "export.csv"

#: Root prefix for imported soft-sensor feature presets. A prefix inside the
#: existing bucket rather than a bucket of its own: `ensure_bucket()` has no
#: runtime caller in this service, so a second bucket would need new bootstrap
#: while a prefix needs none.
PRESET_ROOT = "feature-presets/"
SDTA_FILENAME = "sdta.json"

#: DS-LAKE-009B-T04. Every tmp object is written under a PER-DATASET prefix
#: (`{datasetId}/tmp/{jobId}/...`), so no single S3/MinIO lifecycle Prefix
#: filter can match "tmp/ under any dataset" — Prefix is a literal, anchored
#: match, not a wildcard. An object TAG has no such limitation: tagging every
#: tmp write with this key/value lets one bucket-wide lifecycle rule
#: (`ensure_tmp_lifecycle_rule`) target them regardless of which dataset they
#: belong to.
TMP_LIFECYCLE_TAG_KEY = "lifecycle"
TMP_LIFECYCLE_TAG_VALUE = "tmp"
#: Stable so re-running `ensure_tmp_lifecycle_rule` replaces THIS rule rather
#: than accumulating a duplicate on every app restart.
TMP_LIFECYCLE_RULE_ID = "ds-lake-009b-tmp-expiry"
#: Backstop only — PreprocessingJobService already clears tmp/ on every job
#: success/cancel via /cleanup (see routers/preprocess.py). This rule exists
#: for what that best-effort call misses: a hard crash mid-job, or a
#: straggler that outlives the sweep window. Generous on purpose, since
#: correctness never depends on it firing promptly.
TMP_LIFECYCLE_EXPIRY_DAYS = 7


class ObjectStoreError(RuntimeError):
    """Storage failure with a message safe to surface to the caller."""


class ObjectNotFoundError(ObjectStoreError):
    """The object is not there — as distinct from storage refusing the read.

    A subclass, not a sibling, so every existing `except ObjectStoreError`
    keeps catching it exactly as before; only a caller that WANTS to tell
    the two apart has to change. That distinction matters because the two
    have different remedies: a missing object is gone for good (the bucket
    is not versioned) and the caller's only recovery is to re-materialize
    from the upstream source, while any other storage fault is transient or
    a misconfiguration, where re-fetching would be the wrong response.
    """


def _read_failure(key: str, err: S3Error) -> ObjectStoreError:
    """Pick the failure type for a GET that raised — see `ObjectNotFoundError`.

    One helper rather than the same `if err.code == ...` inline at each of
    the read paths below, which is exactly how those six sites would drift.
    The message text is byte-for-byte what each site raised before this
    split, so nothing matching on it needs updating.
    """
    message = f"Could not read '{key}': {err.code}"
    if err.code == "NoSuchKey":
        return ObjectNotFoundError(message)
    return ObjectStoreError(message)


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

    tags = [c for c in columns if c !=
            TIMESTAMP_COLUMN and not c.endswith(STATUS_SUFFIX)]
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


logger = logging.getLogger(__name__)


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

        self._presign_minio: Minio | None = None
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

        # DS-LAKE-009B-T04: tag tmp writes so ensure_tmp_lifecycle_rule's
        # bucket-wide rule can find them — see TMP_LIFECYCLE_TAG_KEY's doc
        # comment for why a tag is used instead of a Prefix filter.
        object_tags = None
        if "/tmp/" in key:
            object_tags = Tags.new_object_tags()
            object_tags[TMP_LIFECYCLE_TAG_KEY] = TMP_LIFECYCLE_TAG_VALUE

        self.put_object_bytes(
            key,
            payload,
            content_type="application/vnd.apache.parquet",
            tags=object_tags,
        )

        return ArtifactStats(
            object_key=key,
            row_count=int(len(df)),
            column_count=len(tag_columns(df)),
            size_bytes=len(payload),
            missing_pct=missing_pct(df),
            checksum=sha256_hex(payload),
        )

    def put_object_bytes(
        self,
        key: str,
        data: bytes,
        *,
        content_type: str = "application/octet-stream",
        tags: Tags | None = None,
    ) -> None:
        """Raw bytes write — the low-level primitive `put_frame` writes atop.

        DS-LAKE-021-T01: factored out of `put_frame`'s own MinIO-call body
        so `put_frame` and this method share one PUT path instead of two
        near-identical ones (`put_json` still calls `self._client.put_object`
        directly — out of scope here, not folded in). No immutability check
        here — that is `put_frame`'s own concern (committed Parquet
        artifacts refuse an overwrite); a sidecar like `export.csv` is
        written via this method directly and is always free to be rewritten,
        same convention `put_json` already follows for its sidecars.

        Delegates to `put_object_stream` below — a caller with bytes
        already in hand wraps them in `io.BytesIO` rather than this method
        growing a second, near-identical MinIO-call body.
        """
        self.put_object_stream(
            key, io.BytesIO(data), len(data), content_type=content_type, tags=tags
        )

    def put_object_stream(
        self,
        key: str,
        stream: IO[bytes],
        length: int,
        *,
        content_type: str = "application/octet-stream",
        tags: Tags | None = None,
    ) -> None:
        """Streaming write — `put_object_bytes` above is the bytes-in-hand
        convenience wrapper atop this.

        DS-LAKE-021-T01 final-review fix: `export_artifact_csv` builds its
        CSV output into a `SpooledTemporaryFile` rather than an in-memory
        `bytes` value, so it needs a PUT that accepts a file-like object
        directly — wrapping the whole file back into `bytes` just to call
        `put_object_bytes` would defeat the point. `self._client.put_object`
        already accepts any file-like object with `.read()`, so this is a
        thin, direct pass-through, same `S3Error` → `ObjectStoreError`
        wrapping as `put_object_bytes` always had.
        """
        try:
            self._client.put_object(
                self.bucket,
                key,
                stream,
                length=length,
                content_type=content_type,
                tags=tags,
            )
        except S3Error as err:
            raise ObjectStoreError(
                f"Could not write '{key}': {err.code}") from err

    def put_json(self, key: str, document: Any, *, overwrite: bool = True) -> int:
        """Write a JSON sidecar (manifest, feature spec, validation report).

        Overwrites by default, unlike `put_frame`. Sidecars describe the data
        object rather than being it: a validation report may legitimately be
        rewritten for an artifact whose bytes never change. The DATA is what is
        immutable.
        """
        if not overwrite and self.exists(key):
            raise ObjectStoreError(f"Refusing to overwrite sidecar '{key}'.")

        payload = json.dumps(document, indent=2,
                             sort_keys=True, default=str).encode()
        try:
            self._client.put_object(
                self.bucket,
                key,
                io.BytesIO(payload),
                length=len(payload),
                content_type="application/json",
            )
        except S3Error as err:
            raise ObjectStoreError(
                f"Could not write '{key}': {err.code}") from err
        return len(payload)

    # ── read ─────────────────────────────────────────────────────────────

    def get_frame(self, key: str, columns: list[str] | None = None) -> pd.DataFrame:
        # DS-LAKE-005B-C-T07 (large-dataset observability, server-side
        # slice): `get_frame` is the one real read choke point most other
        # reads funnel through (`get_frame_slice` calls this directly) — the
        # natural, single place to log bytes actually pulled from MinIO,
        # same reasoning `put_frame` already logs `size_bytes` on write via
        # `ArtifactStats`. Timed separately from `_run`'s wall-clock figure
        # (routers/preprocess.py) — that measures the WHOLE request
        # including pandas/pyarrow decode; this isolates the storage GET.
        started = time.perf_counter()
        raw = self.get_object_bytes(key)
        elapsed_ms = (time.perf_counter() - started) * 1000
        logger.info(
            "object_store_read key=%s bytes_read=%d elapsed_ms=%.1f",
            key,
            len(raw),
            elapsed_ms,
        )
        table = pq.read_table(io.BytesIO(raw), columns=columns)
        return table.to_pandas()

    def get_object_bytes(self, key: str) -> bytes:
        """Raw bytes read — the low-level primitive `get_frame` decodes atop.

        DS-LAKE-021-T01: factored out of `get_frame`'s own MinIO-call body
        so `get_frame` and this method share one GET path instead of two
        near-identical ones (`get_json`, `get_frame_metadata`, `checksum_of`
        and `get_frame_slice_duckdb` still call `self._client.get_object`
        directly — out of scope here, not folded in). Exists for callers
        that want the whole object as one `bytes` value; `export_service.
        export_artifact_csv` used to be one such caller but now streams via
        `download_to_fileobj` below instead — see that method's own doc
        comment for why.
        """
        response = None
        try:
            response = self._client.get_object(self.bucket, key)
            return response.read()
        except S3Error as err:
            raise _read_failure(key, err) from err
        finally:
            if response is not None:
                response.close()
                response.release_conn()

    def download_to_fileobj(
        self, key: str, fileobj: IO[bytes], *, chunk_bytes: int = 8 * 1024 * 1024
    ) -> int:
        """Chunked GET into a caller-supplied file-like object — the
        streaming counterpart to `get_object_bytes` above.

        DS-LAKE-021-T01 final-review fix: `export_artifact_csv` originally
        called `get_object_bytes`, which materialises the ENTIRE source
        object as one `bytes` value before the caller can do anything with
        it — for a wide numeric artifact this alone made peak memory scale
        with artifact size despite the export loop itself using
        `pq.ParquetFile.iter_batches`. This method never holds more than
        `chunk_bytes` of the response in memory at once; the caller decides
        where the chunks land (a `SpooledTemporaryFile`, typically), which
        is what actually lets peak memory stay flat as row count grows.
        Same `S3Error` → `ObjectStoreError` wrapping and same
        `close()`/`release_conn()` `finally` block as `get_object_bytes` —
        a missing key still raises from `get_object` itself, before any
        chunk is read.
        """
        response = None
        written = 0
        try:
            response = self._client.get_object(self.bucket, key)
            for chunk in response.stream(chunk_bytes):
                fileobj.write(chunk)
                written += len(chunk)
            return written
        except S3Error as err:
            raise _read_failure(key, err) from err
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
            raise _read_failure(key, err) from err
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
            start_time = lo.isoformat(sep=" ") if hasattr(
                lo, "isoformat") else str(lo)
            end_time = hi.isoformat(sep=" ") if hasattr(
                hi, "isoformat") else str(hi)

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
            raise _read_failure(key, err) from err
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
            raise _read_failure(key, err) from err
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
        return self.get_frame(key).iloc[offset: offset + limit].reset_index(drop=True)

    def get_frame_slice_duckdb(
        self, key: str, offset: int = 0, limit: int = 1000
    ) -> pd.DataFrame:
        """DS-LAKE-005B-C-T01: Parquet-native row window, SAME contract as
        `get_frame_slice` above (same signature, same return shape) so the
        two are interchangeable at any call site and directly comparable in
        a golden parity test — this is the "interface" the task asks for:
        two methods sharing one contract, not a separate abstract class with
        a single real implementation and a speculative second one.

        `get_frame_slice` reads the WHOLE object into pyarrow, THEN slices
        in pandas (its own doc comment names this gap explicitly). This
        path instead asks DuckDB's `read_parquet` to push the OFFSET/LIMIT
        down past the row-group metadata, so it need not decode the whole
        file — the intended benefit. DuckDB cannot read an in-memory buffer
        via `read_parquet` (SQL-level table function, needs a path), so the
        object is still downloaded once here (no new network behaviour —
        `get_frame`/`get_frame_slice` do the same single download) and
        staged to a temp file DuckDB opens directly.

        MEASURED, NOT ASSUMED (DS-LAKE-005B-C-T03,
        docs/DS-LAKE-005B-C-BENCHMARK.md, 2026-08-13): at 1,000 rows this
        path is 2.5x-16x SLOWER than `get_frame_slice`, and the gap widens
        with tag count. The per-call temp-file write (up to ~168MB at
        16,000 tags) and the single-row-group case (no row groups to skip
        at this row count) both plausibly dominate — not confirmed, and out
        of scope to chase further here. This method is NOT currently faster
        and is not wired into any live endpoint; do not adopt it on the
        strength of this doc comment's original reasoning — see the
        benchmark report before making that call (AC0: adoption requires
        proven parity/benefit, not an unproven assumption, which is exactly
        what this correction is about).

        Column ORDER matches `get_frame`'s (`SELECT *` preserves file
        column order, same as pyarrow's default) — required for the golden
        parity test's ordering claim to be meaningful.
        """
        if offset < 0 or limit <= 0:
            raise ValueError("offset must be >= 0 and limit must be > 0")

        response = None
        tmp_path: str | None = None
        try:
            response = self._client.get_object(self.bucket, key)
            payload = response.read()
        except S3Error as err:
            raise _read_failure(key, err) from err
        finally:
            if response is not None:
                response.close()
                response.release_conn()

        try:
            with tempfile.NamedTemporaryFile(suffix=".parquet", delete=False) as tmp:
                tmp.write(payload)
                tmp_path = tmp.name
            relation = duckdb.sql(
                f"SELECT * FROM read_parquet(?) OFFSET {offset} LIMIT {limit}",
                params=[tmp_path],
            )
            return relation.df().reset_index(drop=True)
        finally:
            if tmp_path is not None:
                os.unlink(tmp_path)

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

    # ── copy ─────────────────────────────────────────────────────────────

    def copy_prefix(self, src_prefix: str, dst_prefix: str) -> list[str]:
        """Copy every object under `src_prefix` to the same name under
        `dst_prefix`. Returns the destination keys, in listing order.

        DS-LAKE-025: the mechanism behind `artifact_service.adopt_artifact`.
        Save Dataset uses it to bring a draft's committed artifact objects
        into the dataset's OWN namespace, so a persisted dataset never
        depends on a `drafts/` object it does not own — the failure this
        exists to close (a saved dataset whose FINAL 404s from MinIO while
        its Postgres row still reads live) was found in production data,
        not hypothesised.

        Server-side (`copy_object`): the bytes never travel through this
        process, so a wide artifact costs the same here as a small one.
        Single-part server-side copy tops out at 5 GiB per object; nothing
        this service writes is near that, and a source past it would
        surface as a loud `S3Error` rather than a silent truncation.

        An object whose destination already exists is counted and skipped,
        not re-copied. That is what makes a retried Save converge instead
        of failing the second time — the same idempotency `delete_prefix`
        above provides by returning 0 for an absent prefix.
        """
        if not src_prefix.endswith("/") or not dst_prefix.endswith("/"):
            raise ValueError(
                "copy_prefix needs directory-style prefixes ending in '/' — "
                f"got src='{src_prefix}', dst='{dst_prefix}'. Without the "
                "trailing slash the relative-name split below would cut a "
                "filename fragment, the same defect DS-LAKE-016-T02 fixed "
                "in reclaim_artifact."
            )

        copied: list[str] = []
        try:
            for obj in self._client.list_objects(
                self.bucket, prefix=src_prefix, recursive=True
            ):
                src_key = obj.object_name
                dst_key = f"{dst_prefix}{src_key[len(src_prefix):]}"
                if not self.exists(dst_key):
                    self._client.copy_object(
                        self.bucket, dst_key, CopySource(
                            self.bucket, src_key)
                    )
                copied.append(dst_key)
        except S3Error as err:
            raise ObjectStoreError(
                f"Could not copy '{src_prefix}' to '{dst_prefix}': {err.code}"
            ) from err
        return copied

    # ── lifecycle ────────────────────────────────────────────────────────

    def ensure_tmp_lifecycle_rule(self) -> None:
        """DS-LAKE-009B-T04: idempotent bootstrap of a bucket-wide expiry
        rule for tmp/ objects, matched by tag (see TMP_LIFECYCLE_TAG_KEY).

        Backstop only, per TMP_LIFECYCLE_EXPIRY_DAYS's doc comment — the
        application-level /cleanup call remains the primary, prompt path.
        Committed artifact prefixes (`.../artifacts/{artifactId}/`) are
        NEVER expressed here: they need the reference check T08's
        eligibility predicate performs, which a bucket lifecycle rule
        cannot do — only application-level cleanup (ArtifactCleanupService)
        is authoritative for those.

        Has NO automatic runtime caller in this service, deliberately — the
        same convention `ensure_bucket()` already documents on itself.
        `docker-compose.yml` doesn't declare MinIO (it runs as an
        uncommitted `minio-local` container — decisions.storage), so wiring
        this into every app boot would make bucket-lifecycle mutation a
        hard dependency of starting the service at all. Verified live
        against `minio-local` (idempotent: a second call makes no API
        call), and left as an explicit ops bootstrap step — run it once
        per environment, the same way `ensure_bucket()` is.
        """
        desired = Rule(
            ENABLED,
            rule_id=TMP_LIFECYCLE_RULE_ID,
            rule_filter=Filter(
                tag=Tag(TMP_LIFECYCLE_TAG_KEY, TMP_LIFECYCLE_TAG_VALUE)),
            expiration=Expiration(days=TMP_LIFECYCLE_EXPIRY_DAYS),
        )

        try:
            existing = self._client.get_bucket_lifecycle(self.bucket)
        except S3Error as err:
            # NoSuchLifecycleConfiguration means "none set yet" — not a
            # failure to surface.
            if err.code != "NoSuchLifecycleConfiguration":
                raise ObjectStoreError(
                    f"Could not read lifecycle config for '{self.bucket}': "
                    f"{err.code}"
                ) from err
            existing = None

        other_rules = [
            rule
            for rule in (existing.rules if existing else [])
            if rule.rule_id != TMP_LIFECYCLE_RULE_ID
        ]
        current = next(
            (
                rule
                for rule in (existing.rules if existing else [])
                if rule.rule_id == TMP_LIFECYCLE_RULE_ID
            ),
            None,
        )
        if current == desired:
            return  # already in the desired state — no-op, no API call

        try:
            self._client.set_bucket_lifecycle(
                self.bucket, LifecycleConfig([*other_rules, desired])
            )
        except S3Error as err:
            raise ObjectStoreError(
                f"Could not set lifecycle rule on '{self.bucket}': {err.code}"
            ) from err
    # ── presign ──────────────────────────────────────────────────────────
    #
    # A presigned URL is a bearer capability: whoever holds it can perform
    # exactly that one method on that one object until it expires. That is
    # narrower than what a credential grants, which is why the training
    # container gets these instead of S3_ACCESS_KEY — the class docstring's
    # "only this service holds S3 credentials" rule survives intact.

    #: Read TTL. The container downloads data.parquet to local disk BEFORE
    #: training starts (see train.py step 2), so this only has to outlive a
    #: download, not a 3-hour fit. A URL sized to the training run would be a
    #: long-lived capability for no benefit.
    PRESIGN_READ_TTL = timedelta(minutes=15)
    #: Write TTL. Minted at the END of a run, on request, for the same reason.
    PRESIGN_WRITE_TTL = timedelta(minutes=30)

    def _presign_client(self) -> Minio:
        """Minio client bound to the PUBLICLY reachable endpoint.

        SigV4 signs the Host header, so the hostname is baked into the
        signature and cannot be rewritten afterwards without invalidating it.
        `S3_ENDPOINT` is what THIS service dials — per
        `ensure_tmp_lifecycle_rule`'s doc comment MinIO runs as an
        uncommitted `minio-local` container, a name a training container on
        another network cannot resolve. `S3_PUBLIC_ENDPOINT` is the name the
        CONTAINER must use; it falls back to `S3_ENDPOINT` for the case where
        the two are genuinely the same, so a single-network deployment needs
        no new config.
        """
        if getattr(self, "_presign_minio", None) is None:
            raw = getattr(settings, "S3_PUBLIC_ENDPOINT",
                          None) or settings.S3_ENDPOINT
            secure = raw.startswith("https://")
            host = raw.split("://", 1)[-1].rstrip("/")
            self._presign_minio = Minio(
                host,
                access_key=settings.S3_ACCESS_KEY,
                secret_key=settings.S3_SECRET_KEY,
                region=settings.S3_REGION,
                secure=secure,
            )
        return self._presign_minio

    def presigned_get(self, key: str, *, ttl: timedelta | None = None) -> str:
        """Time-limited read URL for one object.

        Requires the object to exist: a URL for a missing key returns 404 only
        once the container is already running, which turns a fixable
        submit-time error into an opaque mid-run failure.
        """
        if not self.exists(key):
            raise ObjectStoreError(
                f"Cannot presign '{key}': object not found.")
        try:
            return self._presign_client().get_presigned_url(
                "GET", self.bucket, key, expires=ttl or self.PRESIGN_READ_TTL
            )
        except S3Error as err:
            raise ObjectStoreError(
                f"Could not presign read for '{key}': {err.code}"
            ) from err

    def presigned_put(self, key: str, *, ttl: timedelta | None = None) -> str:
        """Time-limited write URL for one object.

        No existence check and no overwrite refusal here — unlike `put_frame`,
        this cannot enforce immutability, because the write happens outside
        this process. That is why `is_model_run_key` gates the caller: run
        outputs live under a run id that is created once and never reused, so
        the key is effectively write-once by construction rather than by check.
        """
        try:
            return self._presign_client().get_presigned_url(
                "PUT", self.bucket, key, expires=ttl or self.PRESIGN_WRITE_TTL
            )
        except S3Error as err:
            raise ObjectStoreError(
                f"Could not presign write for '{key}': {err.code}"
            ) from err

# ── key helpers ──────────────────────────────────────────────────────────
#
# These are mirrored in TypeScript at apps/backend/src/lib/artifact-keys.ts.
# Before DS-LAKE-003 the backend rebuilt the same strings inline in three
# places, so a layout change had four independent chances to be missed. Change
# both files together.

#: DS-LAKE-016: stage-suffixed data filenames, for diagnosability — telling a
#: BRONZE from a GOLD while browsing a MinIO console today requires a
#: Postgres round trip. FINAL has NO entry here on purpose: it never gets a
#: file of its own — `promoteDraftArtifactToFinalService` copies `objectKey`
#: from its source verbatim (DS-LAKE-012-V03 proved live that GOLD and FINAL
#: share one checksum, "promotion by pointer, not byte-copy"), and
#: `global_definition_of_done` forbids copying bytes at promotion outright.
DATA_FILENAME_BY_TYPE: dict[str, str] = {
    "BRONZE": "data_bronze.parquet",
    "SILVER": "data_silver.parquet",
    "GOLD": "data_gold.parquet",
    # DS-LAKE-021-T04: EXPORT gets its own entry (unlike FINAL) -- a real,
    # independently-reclaimable object, not a promoted pointer.
    "EXPORT": EXPORT_CSV_FILENAME,
}
#: Every accepted data filename, legacy `data.parquet` included — the FULL
#: set `split_data_key` recognises. A committed object is immutable
#: (`put_frame` refuses an overwrite) and pre-existing objects can never be
#: renamed, so this only ever WIDENS: old spellings must keep resolving
#: forever, not be replaced.
ALL_DATA_FILENAMES: tuple[str, ...] = (
    DATA_FILENAME,
    *DATA_FILENAME_BY_TYPE.values(),
)


def artifact_prefix(dataset_id: str, artifact_id: str) -> str:
    return f"{dataset_id}/artifacts/{artifact_id}/"


def artifact_key(
    dataset_id: str, artifact_id: str, artifact_type: str | None = None
) -> str:
    """`artifact_type` is OPTIONAL and trailing (DS-LAKE-016-T01) so every
    existing caller keeps compiling and keeps producing the legacy
    `data.parquet` name until explicitly updated to pass one. Unknown/FINAL
    types fall back to the legacy name too, rather than raising — this
    function has no live Python caller today (NestJS's mirrored `artifactKey`
    is what actually decides `target_key` for a write), so failing loud here
    would only make CONTRACT PARITY brittle, not catch a real bug.
    """
    filename = DATA_FILENAME_BY_TYPE.get(artifact_type or "", DATA_FILENAME)
    return f"{artifact_prefix(dataset_id, artifact_id)}{filename}"


def manifest_key(dataset_id: str, artifact_id: str) -> str:
    return f"{artifact_prefix(dataset_id, artifact_id)}{MANIFEST_FILENAME}"


def feature_spec_key(dataset_id: str, artifact_id: str) -> str:
    return f"{artifact_prefix(dataset_id, artifact_id)}{FEATURE_SPEC_FILENAME}"


def validation_key(dataset_id: str, artifact_id: str) -> str:
    return f"{artifact_prefix(dataset_id, artifact_id)}{VALIDATION_REPORT_FILENAME}"


def split_data_key(key: str) -> tuple[str, str] | None:
    """DS-LAKE-016-T01: the ONE function that knows the full set of accepted
    data filenames (`ALL_DATA_FILENAMES`), so `sidecar_key`,
    `is_committed_artifact_key` and `reclaim_artifact` cannot drift on which
    names count — the exact drift this key contract exists to prevent, now
    with three more names to get wrong.

    Returns `(prefix, data_filename)` — `prefix` is everything up to and
    including the trailing `/` — if `key` ends in any accepted data
    filename, else `None`. Checked longest-suffix-safe by construction: every
    accepted filename is distinct and none is a suffix of another
    (`data.parquet` vs `data_bronze.parquet` etc. differ before the `.`), so
    at most one entry can ever match.
    """
    for filename in ALL_DATA_FILENAMES:
        suffix = f"/{filename}"
        if key.endswith(suffix):
            return key[: -len(filename)], filename
    return None


def sidecar_key(data_key: str, filename: str) -> str:
    """Sidecar beside an arbitrary data key.

    Needed because the writer is handed a `target_key` and does not always know
    the dataset/artifact ids that produced it. Falls back to appending a suffix
    when the key is not in the artifact layout, so a legacy or tmp key still
    gets a manifest instead of silently getting none.
    """
    split = split_data_key(data_key)
    if split is not None:
        prefix, _ = split
        return f"{prefix}{filename}"
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


MODEL_ROOT = "models/"
# A run started from the wizard has no model_id yet — Save Model has not
# happened (MODEL-FLOW-003-T08). Its outputs write here instead, under the
# ModelDraft that owns it; Save Model later adopts them by pointer rather
# than copying bytes. Mirrored in TypeScript at artifact-keys.ts.
DRAFT_ROOT = "drafts/"
MODEL_FILENAME = "model.joblib"
METRICS_FILENAME = "metrics.json"
RUN_MANIFEST_FILENAME = "run_manifest.json"
PREDICTIONS_FILENAME = "predictions.parquet"
# MODEL-FLOW-013-T05. Only present for the algorithms train.py can extract a
# real loss trajectory from — absent, not empty, for a closed-form fit.
LOSS_HISTORY_FILENAME = "loss_history.json"


def model_run_prefix(model_id: str, run_id: str) -> str:
    return f"{MODEL_ROOT}{model_id}/runs/{run_id}/"


def model_run_key(model_id: str, run_id: str, filename: str) -> str:
    return f"{model_run_prefix(model_id, run_id)}{filename}"


def draft_run_prefix(draft_id: str, run_id: str) -> str:
    return f"{DRAFT_ROOT}{draft_id}/runs/{run_id}/"


def draft_run_key(draft_id: str, run_id: str, filename: str) -> str:
    return f"{draft_run_prefix(draft_id, run_id)}{filename}"


def is_committed_artifact_key(key: str) -> bool:
    """Whether `key` is a committed artifact's data object.

    The same predicate `/artifacts/reclaim` needs, extracted so the presign
    guard cannot drift from it. Deliberately NOT a check that the object
    exists — that is a separate question, and conflating the two would make
    "malformed key" and "missing artifact" indistinguishable to the caller.

    DS-LAKE-016: routed through `split_data_key` so a stage-suffixed key
    (e.g. `.../data_gold.parquet`) is recognised too — before this it was
    legacy-`data.parquet`-only, which would have refused presigning or
    reclaiming a real, freshly-written stage-suffixed artifact outright.
    """
    return "/artifacts/" in key and split_data_key(key) is not None


def is_model_run_key(key: str) -> bool:
    """Whether `key` is a well-formed training-run output object.

    Structural, not substring: requires exactly
    `models/{model_id}/runs/{run_id}/{filename}` — four non-empty path
    segments after the root, none of them `.` or `..`. A substring test
    (`startswith("models/") and "/runs/" in key`) would accept a traversal
    like `models/../../x/runs/y/z`, which the old implementation did. This
    is the one thing standing between a malformed id and a presigned write
    outside `models/` (see `presign_model_run_upload`'s own comment).
    """
    if not key.startswith(MODEL_ROOT):
        return False
    parts = key[len(MODEL_ROOT):].split("/")
    if len(parts) != 4 or parts[1] != "runs":
        return False
    return all(segment and segment not in (".", "..") for segment in parts)


def is_draft_run_key(key: str) -> bool:
    """Whether `key` is a well-formed draft-scoped training-run output object.

    Same structural shape as `is_model_run_key`, rooted at `drafts/` instead
    of `models/` — a run started from the wizard has no model_id yet
    (MODEL-FLOW-003-T08). Kept as a separate predicate rather than widening
    `is_model_run_key` to accept either root: the two roots are never
    interchangeable at a call site (a caller must already know which scope
    it is minting a URL for), so merging them would let a bug pick the wrong
    root silently instead of failing a type/branch check.
    """
    if not key.startswith(DRAFT_ROOT):
        return False
    parts = key[len(DRAFT_ROOT):].split("/")
    if len(parts) != 4 or parts[1] != "runs":
        return False
    return all(segment and segment not in (".", "..") for segment in parts)
