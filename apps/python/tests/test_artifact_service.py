"""Guards for the four calls the NestJS job runner makes.

The runner is fire-and-forget: nothing downstream is watching, so a mistake here
surfaces as a dataset that is quietly wrong rather than a request that fails.
Most of what follows pins the REFUSALS — the cases where writing something
would be worse than writing nothing.

Storage is faked, for the reason spelled out in `test_preview_service.py`: a
guarantee that skips when MinIO is down proves nothing. Here the fake records
writes rather than forbidding them, since these operations are meant to write.
Credentials in the MaterializeRequest tests are synthetic and never dialled —
both cases assert the request is rejected before any fetch happens.
"""

from __future__ import annotations

import pandas as pd
import pytest

from intergrations.object_store import (
    STATUS_BAD,
    STATUS_GOOD,
    ArtifactStats,
    ObjectStoreError,
    missing_pct,
    tag_columns,
)
from schemas.preprocess import (
    CleaningOperation,
    CleanRequest,
    CleanupRequest,
    MaterializeRequest,
    RowsRequest,
)
from services import artifact_service

TS = pd.to_datetime([f"2026-06-22 00:0{i}:00" for i in range(6)])


def frame(statuses: list[int] | None = None) -> pd.DataFrame:
    codes = statuses or [
        STATUS_GOOD,
        STATUS_GOOD,
        STATUS_BAD,
        STATUS_GOOD,
        STATUS_GOOD,
        STATUS_GOOD,
    ]
    return pd.DataFrame(
        {
            "timestamp": TS,
            "TI-101": [70.0, 71.0, 0.0, 73.0, 74.0, 75.0],
            "TI-101__status": pd.array(codes, dtype="int8"),
        }
    )


class RecordingStore:
    """In-memory stand-in that keeps the real store's immutability rule.

    Reproducing the overwrite refusal matters: the runner writes its final step
    straight to the committed version key, so "refuses to clobber a committed
    artifact" is behaviour the runner depends on, not an internal detail of
    `ObjectStore`.
    """

    def __init__(self, objects: dict[str, pd.DataFrame] | None = None) -> None:
        self.objects: dict[str, pd.DataFrame] = dict(objects or {})
        self.writes: list[str] = []
        self.deleted_prefixes: list[str] = []

    def get_frame(self, key: str) -> pd.DataFrame:
        if key not in self.objects:
            raise ObjectStoreError(f"Could not read '{key}': NoSuchKey")
        return self.objects[key].copy()

    def put_frame(
        self, df: pd.DataFrame, key: str, *, overwrite: bool = False
    ) -> ArtifactStats:
        if not overwrite and key in self.objects:
            raise ObjectStoreError(
                f"Refusing to overwrite committed artifact '{key}'. "
                "Dataset versions are immutable — write a new version instead."
            )
        self.objects[key] = df.copy()
        self.writes.append(key)
        return ArtifactStats(
            object_key=key,
            row_count=int(len(df)),
            column_count=len(tag_columns(df)),
            size_bytes=1024,
            missing_pct=missing_pct(df),
        )

    def delete_prefix(self, prefix: str) -> int:
        hits = [k for k in self.objects if k.startswith(prefix)]
        for key in hits:
            del self.objects[key]
        self.deleted_prefixes.append(prefix)
        return len(hits)


# ── clean ────────────────────────────────────────────────────────────────


def test_clean_writes_the_target_and_leaves_the_source_alone() -> None:
    store = RecordingStore({"ds-1/v1.parquet": frame()})
    result = artifact_service.clean(
        store,
        CleanRequest(
            source_key="ds-1/v1.parquet",
            target_key="ds-1/tmp/job-1/1.parquet",
            operations=[CleaningOperation(type="drop_missing")],
        ),
    )

    assert result["object_key"] == "ds-1/tmp/job-1/1.parquet"
    assert result["row_count"] == 5  # the Bad row is gone
    assert result["missing_pct"] == 0.0
    assert "duration_ms" in result
    # Immutability is the entire reason steps chain through tmp keys.
    assert store.objects["ds-1/v1.parquet"].equals(frame())
    assert store.writes == ["ds-1/tmp/job-1/1.parquet"]


def test_clean_refuses_to_write_over_a_committed_version() -> None:
    store = RecordingStore({"ds-1/v1.parquet": frame(), "ds-1/v2.parquet": frame()})
    with pytest.raises(ObjectStoreError, match="immutable"):
        artifact_service.clean(
            store,
            CleanRequest(
                source_key="ds-1/v1.parquet",
                target_key="ds-1/v2.parquet",
                operations=[],
            ),
        )


def test_clean_may_rewrite_its_own_tmp_step_on_retry() -> None:
    key = "ds-1/tmp/job-1/1.parquet"
    store = RecordingStore({"ds-1/v1.parquet": frame(), key: frame()})
    artifact_service.clean(
        store,
        CleanRequest(
            source_key="ds-1/v1.parquet",
            target_key=key,
            operations=[],
            overwrite=True,
        ),
    )
    assert store.writes == [key]


def test_a_pipeline_that_drops_every_row_fails_instead_of_committing_nothing() -> None:
    """An empty frame is valid Parquet, so without a guard the job SUCCEEDS.

    The user would then get a committed version with rowCount 0 and no error
    explaining where their data went.
    """
    store = RecordingStore({"ds-1/v1.parquet": frame([STATUS_BAD] * 6)})
    with pytest.raises(ValueError, match="no rows"):
        artifact_service.clean(
            store,
            CleanRequest(
                source_key="ds-1/v1.parquet",
                target_key="ds-1/tmp/job-1/1.parquet",
                operations=[CleaningOperation(type="drop_missing")],
            ),
        )
    assert store.writes == []


def test_clean_rejects_a_target_equal_to_its_source() -> None:
    with pytest.raises(ValueError, match="must differ"):
        CleanRequest(
            source_key="ds-1/v1.parquet", target_key="ds-1/v1.parquet", operations=[]
        )


def test_clean_surfaces_a_missing_source_rather_than_writing_an_empty_target() -> None:
    store = RecordingStore()
    with pytest.raises(ObjectStoreError):
        artifact_service.clean(
            store,
            CleanRequest(
                source_key="ds-1/nope.parquet",
                target_key="ds-1/tmp/job-1/1.parquet",
                operations=[],
            ),
        )
    assert store.writes == []


# ── rows ─────────────────────────────────────────────────────────────────


def test_rows_pages_and_reports_the_whole_artifact_height() -> None:
    store = RecordingStore({"ds-1/v1.parquet": frame()})
    page = artifact_service.rows(
        store, RowsRequest(source_key="ds-1/v1.parquet", offset=2, limit=2)
    )

    assert page["total_row_count"] == 6  # the artifact, not the page
    assert page["offset"] == 2
    assert len(page["rows"]) == 2
    assert page["tags"] == ["TI-101"]
    # Offset 2 is the Bad hole; status must survive the trip.
    assert page["rows"][0]["cells"]["TI-101"] == {"value": 0.0, "status": "Bad"}
    assert page["rows"][1]["cells"]["TI-101"]["status"] == "Good"


def test_rows_past_the_end_is_an_empty_page_not_an_error() -> None:
    """The client pages until it has `total_row_count`; a race must not 500."""
    store = RecordingStore({"ds-1/v1.parquet": frame()})
    page = artifact_service.rows(
        store, RowsRequest(source_key="ds-1/v1.parquet", offset=99, limit=10)
    )
    assert page["rows"] == []
    assert page["total_row_count"] == 6


def test_rows_reads_only() -> None:
    store = RecordingStore({"ds-1/v1.parquet": frame()})
    artifact_service.rows(store, RowsRequest(source_key="ds-1/v1.parquet"))
    assert store.writes == []
    assert store.deleted_prefixes == []


# ── cleanup ──────────────────────────────────────────────────────────────


def test_cleanup_clears_only_the_named_job() -> None:
    store = RecordingStore(
        {
            "ds-1/v1.parquet": frame(),
            "ds-1/tmp/job-1/1.parquet": frame(),
            "ds-1/tmp/job-1/2.parquet": frame(),
            "ds-1/tmp/job-2/1.parquet": frame(),
        }
    )
    result = artifact_service.cleanup(store, CleanupRequest(prefix="ds-1/tmp/job-1/"))

    assert result["deleted"] == 2
    assert set(store.objects) == {"ds-1/v1.parquet", "ds-1/tmp/job-2/1.parquet"}


def test_cleanup_refuses_a_prefix_outside_tmp() -> None:
    """The dangerous input: `ds-1/` would delete every committed version."""
    with pytest.raises(ValueError, match="outside tmp/"):
        CleanupRequest(prefix="ds-1/")


def test_cleanup_requires_a_trailing_slash() -> None:
    """Without it, `ds-1/tmp/job-1` also matches `ds-1/tmp/job-10/...`."""
    with pytest.raises(ValueError, match="end with"):
        CleanupRequest(prefix="ds-1/tmp/job-1")


# ── materialize request validation ───────────────────────────────────────
#
# The fetch itself needs a live PI/SQL source and is covered by the F4
# end-to-end run. What is pinned here is the ROUTING decision, because both
# "neither" and "both" have a plausible-looking wrong answer: write an empty
# artifact, or silently prefer one source over the other.


def test_materialize_requires_exactly_one_source() -> None:
    with pytest.raises(ValueError, match="exactly one"):
        MaterializeRequest(target_key="ds-1/v1.parquet")


def test_materialize_rejects_two_sources() -> None:
    pi = {
        "credentials": {
            "api_server": "pi.example",
            "pi_server": "PISRV",
            "user": "synthetic",
            "password": "synthetic",
        },
        "tag_list": ["TI-101"],
        "start_time": "2026-06-22 00:00:00.000000",
        "end_time": "2026-06-22 01:00:00.000000",
    }
    sql = {
        "query": {
            "credentials": {
                "driver": "postgres",
                "host": "db.example",
                "port": 5432,
                "database": "d",
                "user": "synthetic",
                "password": "synthetic",
            },
            "table": "readings",
        },
        "timestamp_column": "ts",
    }
    with pytest.raises(ValueError, match="exactly one"):
        MaterializeRequest(target_key="ds-1/v1.parquet", pi=pi, sql=sql)


# ── the empty-fetch guard, directly ──────────────────────────────────────


def test_usable_guard_rejects_a_frame_with_no_tags() -> None:
    with pytest.raises(ValueError, match="no rows|no tag columns"):
        artifact_service.assert_frame_is_usable(pd.DataFrame({"timestamp": TS}))


def test_usable_guard_accepts_a_normal_frame() -> None:
    artifact_service.assert_frame_is_usable(frame())
