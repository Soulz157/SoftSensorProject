"""Artifact lifecycle: materialize V1, clean one step, page rows, clear tmp.

These are the four calls the NestJS job runner makes. Everything here is
synchronous and CPU- or I/O-bound; the router runs it via `asyncio.to_thread`
so a large frame never occupies the event loop.

Division of labour, restated because it is easy to erode:

* NestJS owns authorization, dataset ownership, version numbering and job state.
* This service owns the data and holds the only S3 credentials in the system.

That last point is why `cleanup` exists at all — NestJS cannot delete its own
tmp objects.
"""

from __future__ import annotations

import asyncio
import time
from typing import Any

import pandas as pd

from intergrations.object_store import (
    MANIFEST_FILENAME,
    TIMESTAMP_COLUMN,
    ArtifactStats,
    ObjectStore,
    build_manifest,
    sidecar_key,
    tag_columns,
)
from schemas.preprocess import (
    CleanRequest,
    CleanupRequest,
    MaterializeRequest,
    RowsRequest,
)
from services.cleaning_service import apply_operations
from services.data_source_service import PIDataSourceService, SQLDataSourceService
from services.frame_service import from_pi_response, from_sql_response
from services.preview_service import sample_rows

_pi = PIDataSourceService()
_sql = SQLDataSourceService()


def _stats_payload(stats: ArtifactStats, started: float) -> dict[str, Any]:
    return {
        "object_key": stats.object_key,
        "row_count": stats.row_count,
        "column_count": stats.column_count,
        "size_bytes": stats.size_bytes,
        "missing_pct": stats.missing_pct,
        "checksum": stats.checksum,
        "duration_ms": int((time.perf_counter() - started) * 1000),
    }


def _commit(
    store: ObjectStore,
    stats: ArtifactStats,
    started: float,
    *,
    parent_key: str | None = None,
    operations: Any = None,
) -> dict[str, Any]:
    """Write the manifest beside the data, then return the response payload.

    The manifest is written AFTER the data, and its failure does not unwind the
    data object. That ordering is deliberate: the data is the expensive thing to
    reproduce and a manifest can be rebuilt from the object plus its row, while
    the reverse ordering would let a manifest describe an artifact that does not
    exist.
    """
    payload = _stats_payload(stats, started)
    store.put_json(
        sidecar_key(stats.object_key, MANIFEST_FILENAME),
        build_manifest(
            stats,
            parent_key=parent_key,
            operations=operations,
            duration_ms=payload["duration_ms"],
        ),
    )
    return payload


def assert_frame_is_usable(frame: pd.DataFrame) -> None:
    """Reject an empty fetch loudly, before anything is written.

    A zero-row frame is a legal Parquet file, so without this the job succeeds,
    a DatasetVersion row is committed with rowCount 0, and the user is shown an
    empty dataset with no error to explain it.
    """
    if len(frame) == 0:
        raise ValueError(
            "The source returned no rows for the requested range. Nothing was "
            "written — check the time range and the tag selection."
        )
    if not tag_columns(frame):
        raise ValueError(
            "The source returned rows but no tag columns besides "
            f"{TIMESTAMP_COLUMN!r}."
        )


def _as_mapping(response: Any) -> dict[str, Any]:
    """Pydantic response -> plain dict for `frame_service`."""
    return response.model_dump() if hasattr(response, "model_dump") else dict(response)


def materialize(store: ObjectStore, request: MaterializeRequest) -> dict[str, Any]:
    """Fetch from the source, normalise, and write the raw artifact.

    The two source shapes are genuinely different and converge only here: PI is
    tag-major with no shared time axis, SQL is row-major and already aligned.
    `frame_service` reconciles them; this function only routes and writes.
    """
    started = time.perf_counter()

    if request.pi is not None:
        # `_pi.fetch` is a coroutine, and this module runs inside a worker
        # thread with no event loop of its own, so it is driven to completion
        # here. `asyncio.run` is safe precisely BECAUSE this is not the main
        # thread — calling it on the loop thread would raise.
        response = asyncio.run(
            _pi.fetch(request.pi, interval=request.pi.summary_duration or "1m")
        )
        frame = from_pi_response(_as_mapping(response))
    else:
        spec = request.sql
        assert spec is not None  # guaranteed by MaterializeRequest's validator
        frame = from_sql_response(
            _as_mapping(_sql.query(spec.query)),
            timestamp_column=spec.timestamp_column,
            tags=spec.tags,
        )

    assert_frame_is_usable(frame)
    stats = store.put_frame(frame, request.target_key, overwrite=request.overwrite)
    # No parent: a materialised artifact is a lineage root — it comes from the
    # source system, not from another artifact.
    return _commit(store, stats, started)


def clean(store: ObjectStore, request: CleanRequest) -> dict[str, Any]:
    """Apply operations from `source_key` to `target_key`.

    Accepts a LIST even though the runner sends one operation at a time: a
    caller that does not need per-operation progress (a test, a future batch
    path) should not have to make N round trips to apply N operations.
    """
    started = time.perf_counter()

    result = apply_operations(
        store.get_frame(request.source_key),
        [operation.to_step() for operation in request.operations],
        request.precision,
    )
    # A pipeline that drops every row is a configuration mistake, not a
    # dataset. Catching it here means the job FAILS with a reason instead of
    # committing an empty version.
    assert_frame_is_usable(result)

    stats = store.put_frame(result, request.target_key, overwrite=request.overwrite)
    return _commit(
        store,
        stats,
        started,
        parent_key=request.source_key,
        operations=[operation.to_step() for operation in request.operations],
    )


def rows(store: ObjectStore, request: RowsRequest) -> dict[str, Any]:
    """One page of a committed artifact, in the shape the client renders.

    `total_row_count` describes the whole artifact, not the page, so the client
    knows when to stop paging without a separate count call.
    """
    frame = store.get_frame(request.source_key)
    total = int(len(frame))
    page = frame.iloc[request.offset : request.offset + request.limit].reset_index(
        drop=True
    )

    return {
        "source_key": request.source_key,
        "total_row_count": total,
        "offset": request.offset,
        "tags": tag_columns(frame),
        # Same wide {timestamp, cells:{tag:{value,status}}} shape the preview
        # returns, so the client keeps one row renderer rather than two.
        "rows": sample_rows(page, len(page)),
    }


def cleanup(store: ObjectStore, request: CleanupRequest) -> dict[str, Any]:
    """Clear a tmp prefix. `CleanupRequest` already refuses anything outside tmp/."""
    return {
        "prefix": request.prefix,
        "deleted": store.delete_prefix(request.prefix),
    }
