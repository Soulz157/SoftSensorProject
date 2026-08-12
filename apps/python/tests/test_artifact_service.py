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
    ArtifactReclaimRequest,
    CleaningOperation,
    CleanRequest,
    CleanupRequest,
    ColumnStatsRequest,
    MaterializeRequest,
    MetadataRequest,
    RowsRequest,
    TagCatalogRequest,
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


def wide_frame() -> pd.DataFrame:
    """Two tags, so a tag-filter test can prove the OTHER tag is really gone."""
    return pd.DataFrame(
        {
            "timestamp": TS,
            "TI-101": [70.0, 71.0, 72.0, 73.0, 74.0, 75.0],
            "TI-101__status": pd.array([STATUS_GOOD] * 6, dtype="int8"),
            "FI-404": [10.0, 11.0, 12.0, 13.0, 14.0, 15.0],
            "FI-404__status": pd.array([STATUS_GOOD] * 6, dtype="int8"),
        }
    )


def many_tags_frame(names: list[str]) -> pd.DataFrame:
    """A frame with exactly the given tag names — for catalog pagination and
    search tests, where only the NAMES matter, not the values.
    """
    data: dict[str, object] = {"timestamp": TS}
    for name in names:
        data[name] = [0.0] * len(TS)
        data[f"{name}__status"] = pd.array([STATUS_GOOD] * len(TS), dtype="int8")
    return pd.DataFrame(data)


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
        #: Sidecars land here rather than in `objects`, so a test asserting on
        #: data writes is never confused by a manifest.
        self.documents: dict[str, object] = {}
        #: Distinct from `get_frame_metadata` calls — a test proving "never
        #: decodes tag/status values" needs to know THIS was zero, not just
        #: that nothing was written.
        self.get_frame_calls = 0

    def get_frame(self, key: str, columns: list[str] | None = None) -> pd.DataFrame:
        self.get_frame_calls += 1
        if key not in self.objects:
            raise ObjectStoreError(f"Could not read '{key}': NoSuchKey")
        df = self.objects[key]
        if columns is None:
            return df.copy()
        # Mirrors pyarrow's real refusal (ArrowInvalid, a ValueError subclass —
        # confirmed against a live pq.read_table call) so a test against this
        # fake proves the same error class the router's except-chain expects.
        missing = [c for c in columns if c not in df.columns]
        if missing:
            raise ValueError(f"No match for FieldRef.Name({missing[0]!r}) in schema")
        return df[columns].copy()

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
            checksum="0" * 64,
        )

    def put_json(self, key: str, document: object, *, overwrite: bool = True) -> int:
        """Sidecar write. Mirrors the real store: overwrite ALLOWED by default.

        The refusal rule exists for data objects; a manifest may legitimately be
        rewritten for an artifact whose bytes never change.
        """
        if not overwrite and key in self.documents:
            raise ObjectStoreError(f"Refusing to overwrite sidecar '{key}'.")
        self.documents[key] = document
        return 1

    def get_json(self, key: str) -> object:
        # Mirrors the real store's refusal (ObjectStoreError) on a missing
        # key — DS-LAKE-005B-A-T07's column_stats read maps this to 422
        # through the same except-chain a missing data object already uses.
        if key not in self.documents:
            raise ObjectStoreError(f"Could not read '{key}': NoSuchKey")
        return self.documents[key]

    def delete_prefix(self, prefix: str) -> int:
        hits = [k for k in self.objects if k.startswith(prefix)]
        for key in hits:
            del self.objects[key]
        self.deleted_prefixes.append(prefix)
        return len(hits)

    def get_frame_metadata(self, key: str) -> dict[str, object]:
        if key not in self.objects:
            raise ObjectStoreError(f"Could not read '{key}': NoSuchKey")
        df = self.objects[key]
        tags = sorted(tag_columns(df))  # mirrors ObjectStore.get_frame_metadata
        column_count = len(df.columns)
        if len(df) == 0:
            return {
                "tags": tags,
                "column_count": column_count,
                "row_count": 0,
                "start_time": None,
                "end_time": None,
            }
        lo, hi = df["timestamp"].min(), df["timestamp"].max()
        return {
            "tags": tags,
            "column_count": column_count,
            "row_count": int(len(df)),
            "start_time": (
                lo.isoformat(sep=" ") if hasattr(lo, "isoformat") else str(lo)
            ),
            "end_time": hi.isoformat(sep=" ") if hasattr(hi, "isoformat") else str(hi),
        }


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
    assert page["filtered"] is False
    assert page["start_time"] is None
    assert page["end_time"] is None


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


def test_rows_limit_is_bounded_regardless_of_artifact_size() -> None:
    """T02-V01: the ceiling is on the REQUEST, not conditional on how big the
    source is — proven here against a 6-row artifact, the smallest kind.
    """
    with pytest.raises(ValueError):
        RowsRequest(source_key="ds-1/v1.parquet", limit=50_001)


# ── rows: tag filter / column projection (DS-LAKE-005B-A-T02) ────────────


def test_rows_tag_filter_projects_columns_and_the_other_tag_is_gone() -> None:
    store = RecordingStore({"ds-1/v1.parquet": wide_frame()})
    page = artifact_service.rows(
        store, RowsRequest(source_key="ds-1/v1.parquet", tags=["TI-101"])
    )

    assert page["tags"] == ["TI-101"]
    assert all("FI-404" not in row["cells"] for row in page["rows"])
    # A tag filter alone is not a TIME filter — total_row_count still
    # describes every row, just narrower columns.
    assert page["filtered"] is False


def test_rows_unknown_tag_is_rejected_not_silently_dropped() -> None:
    store = RecordingStore({"ds-1/v1.parquet": wide_frame()})
    with pytest.raises(ValueError):
        artifact_service.rows(
            store, RowsRequest(source_key="ds-1/v1.parquet", tags=["NOPE"])
        )


def test_rows_omitted_tags_still_returns_every_tag() -> None:
    store = RecordingStore({"ds-1/v1.parquet": wide_frame()})
    page = artifact_service.rows(store, RowsRequest(source_key="ds-1/v1.parquet"))
    assert set(page["tags"]) == {"TI-101", "FI-404"}


# ── rows: start/end time filter (DS-LAKE-005B-A-T02) ─────────────────────


def test_rows_time_filter_narrows_the_total_and_the_page() -> None:
    store = RecordingStore({"ds-1/v1.parquet": frame()})
    page = artifact_service.rows(
        store,
        RowsRequest(
            source_key="ds-1/v1.parquet",
            start_time="2026-06-22 00:02:00",
            end_time="2026-06-22 00:03:00",
        ),
    )

    assert page["total_row_count"] == 2  # not the artifact's 6
    assert len(page["rows"]) == 2
    assert page["rows"][0]["timestamp"] == "2026-06-22 00:02:00"
    assert page["rows"][1]["timestamp"] == "2026-06-22 00:03:00"
    # The response announces the filter it applied — a caller must be able to
    # tell "2 rows total" from "2 rows in this window" without re-sending
    # the request it made.
    assert page["filtered"] is True
    assert page["start_time"] == "2026-06-22 00:02:00"
    assert page["end_time"] == "2026-06-22 00:03:00"


def test_rows_time_filter_offset_and_limit_apply_to_the_filtered_view() -> None:
    """`offset` pages the FILTERED result, not the raw file — otherwise a
    tight time window plus a nonzero offset would silently return nothing.
    """
    store = RecordingStore({"ds-1/v1.parquet": frame()})
    page = artifact_service.rows(
        store,
        RowsRequest(
            source_key="ds-1/v1.parquet",
            start_time="2026-06-22 00:01:00",
            offset=1,
            limit=2,
        ),
    )
    # Filtered view is rows 1..5 (5 rows); offset 1 into that starts at row 2.
    assert page["total_row_count"] == 5
    assert page["rows"][0]["timestamp"] == "2026-06-22 00:02:00"


# ── rows: Arrow IPC transport (DS-LAKE-005B-A-T05) ────────────────────────


def test_rows_arrow_returns_the_same_page_as_json_in_binary() -> None:
    """The discriminating claim: `rows_arrow` must describe the SAME page
    `rows` does — same values, same statuses, same envelope scalars — just
    encoded differently. Decodes the Arrow IPC stream with pyarrow itself
    (not a hand-rolled parser) so a real client's decode path is exercised.
    """
    import pyarrow as pa

    store = RecordingStore({"ds-1/v1.parquet": wide_frame()})
    request = RowsRequest(source_key="ds-1/v1.parquet", offset=1, limit=3)

    json_page = artifact_service.rows(store, request)
    response = artifact_service.rows_arrow(store, request)

    assert response.media_type == "application/vnd.apache.arrow.stream"
    assert response.headers["X-Total-Row-Count"] == str(json_page["total_row_count"])
    assert response.headers["X-Offset"] == "1"
    assert response.headers["X-Filtered"] == "false"
    assert "X-Start-Time" not in response.headers  # absent, not empty-string

    table = pa.ipc.open_stream(response.body).read_all()
    assert table.column_names == ["timestamp", "TI-101", "TI-101__status", "FI-404", "FI-404__status"]
    assert table.num_rows == len(json_page["rows"]) == 3

    decoded = table.to_pylist()
    for arrow_row, json_row in zip(decoded, json_page["rows"]):
        assert arrow_row["TI-101"] == json_row["cells"]["TI-101"]["value"]
        assert arrow_row["FI-404"] == json_row["cells"]["FI-404"]["value"]


def test_rows_arrow_time_filter_sets_the_filtered_header_and_range() -> None:
    store = RecordingStore({"ds-1/v1.parquet": frame()})
    request = RowsRequest(
        source_key="ds-1/v1.parquet",
        start_time="2026-06-22 00:01:00",
        offset=0,
        limit=100,
    )

    response = artifact_service.rows_arrow(store, request)

    assert response.headers["X-Filtered"] == "true"
    assert response.headers["X-Start-Time"] == "2026-06-22 00:01:00"
    assert response.headers["X-Total-Row-Count"] == "5"


def test_rows_arrow_unknown_tag_raises_the_same_error_json_would() -> None:
    """Both formats must fail the SAME way for the same bad input — proven
    at the service level here; the HTTP-level sibling below proves the
    router's error mapping (`_run`) actually catches it as 422, not 502.
    """
    store = RecordingStore({"ds-1/v1.parquet": wide_frame()})
    request = RowsRequest(source_key="ds-1/v1.parquet", tags=["NOPE-1"])

    with pytest.raises(ValueError):
        artifact_service.rows(store, request)
    with pytest.raises(ValueError):
        artifact_service.rows_arrow(store, request)


def test_rows_json_is_still_the_default_format() -> None:
    """`format` defaults to json — every existing caller that never sends it
    must keep getting the JSON body unchanged."""
    assert RowsRequest(source_key="ds-1/v1.parquet").format == "json"


# ── tag catalog (DS-LAKE-005B-A-T03) ──────────────────────────────────────

CATALOG_TAGS = ["TI-101", "TI-102", "FI-404", "PI-201", "LI-303"]


def test_tag_catalog_is_alphabetical_not_file_order() -> None:
    store = RecordingStore({"ds-1/v1.parquet": many_tags_frame(CATALOG_TAGS)})
    page = artifact_service.tag_catalog(
        store, TagCatalogRequest(source_key="ds-1/v1.parquet", limit=10)
    )

    assert page["tags"] == ["FI-404", "LI-303", "PI-201", "TI-101", "TI-102"]
    assert page["total_count"] == 5


def test_tag_catalog_pages_without_loading_the_whole_list() -> None:
    store = RecordingStore({"ds-1/v1.parquet": many_tags_frame(CATALOG_TAGS)})
    page = artifact_service.tag_catalog(
        store, TagCatalogRequest(source_key="ds-1/v1.parquet", offset=2, limit=2)
    )

    assert page["tags"] == ["PI-201", "TI-101"]  # alphabetical index 2..3
    assert page["total_count"] == 5  # the full match count, not the page
    assert page["offset"] == 2


def test_tag_catalog_search_is_a_case_insensitive_substring_match() -> None:
    store = RecordingStore({"ds-1/v1.parquet": many_tags_frame(CATALOG_TAGS)})
    page = artifact_service.tag_catalog(
        store, TagCatalogRequest(source_key="ds-1/v1.parquet", search="ti-1")
    )

    assert page["tags"] == ["TI-101", "TI-102"]
    assert page["total_count"] == 2
    assert page["search"] == "ti-1"


def test_tag_catalog_search_with_no_matches_is_an_empty_page_not_an_error() -> None:
    store = RecordingStore({"ds-1/v1.parquet": many_tags_frame(CATALOG_TAGS)})
    page = artifact_service.tag_catalog(
        store, TagCatalogRequest(source_key="ds-1/v1.parquet", search="nope")
    )

    assert page["tags"] == []
    assert page["total_count"] == 0


def test_tag_catalog_never_decodes_row_values() -> None:
    """A catalog that opened tag/status columns would defeat the entire point
    of DS-LAKE-005B-A-T03 for an 8,000-tag artifact.
    """
    store = RecordingStore({"ds-1/v1.parquet": many_tags_frame(CATALOG_TAGS)})
    artifact_service.tag_catalog(
        store, TagCatalogRequest(source_key="ds-1/v1.parquet")
    )
    assert store.get_frame_calls == 0  # only get_frame_metadata was used
    assert store.writes == []
    assert store.deleted_prefixes == []


def test_tag_catalog_limit_is_bounded_regardless_of_artifact_size() -> None:
    """Same shape as test_rows_limit_is_bounded_regardless_of_artifact_size —
    a SEPARATE ceiling from RowsRequest's, since a tag-catalog page has
    nothing to do with a row-limit budget.
    """
    with pytest.raises(ValueError):
        TagCatalogRequest(source_key="ds-1/v1.parquet", limit=5_001)


def test_tag_catalog_empty_search_means_every_tag() -> None:
    """Both layers already agree here (falsy in Python, falsy in NestJS's
    `query.search &&` guard) — pinned so a future edit to either cannot
    quietly split them the way the T02 `tags=''` case did.
    """
    store = RecordingStore({"ds-1/v1.parquet": many_tags_frame(CATALOG_TAGS)})
    page = artifact_service.tag_catalog(
        store, TagCatalogRequest(source_key="ds-1/v1.parquet", search="", limit=10)
    )
    assert page["total_count"] == 5


# ── metadata (DS-LAKE-005B-A-T01) ───────────────────────────────────────


def test_metadata_reports_tags_and_time_range() -> None:
    store = RecordingStore({"ds-1/v1.parquet": frame()})
    meta = artifact_service.metadata(
        store, MetadataRequest(source_key="ds-1/v1.parquet")
    )

    assert meta["tags"] == ["TI-101"]
    assert meta["column_count"] == 3  # timestamp + TI-101 + TI-101__status (2N+1)
    assert meta["row_count"] == 6
    assert meta["start_time"] == "2026-06-22 00:00:00"
    assert meta["end_time"] == "2026-06-22 00:05:00"


def test_metadata_of_an_empty_artifact_has_no_time_range() -> None:
    empty = frame().iloc[0:0]
    store = RecordingStore({"ds-1/empty.parquet": empty})
    meta = artifact_service.metadata(
        store, MetadataRequest(source_key="ds-1/empty.parquet")
    )

    assert meta["row_count"] == 0
    assert meta["start_time"] is None
    assert meta["end_time"] is None


def test_metadata_reads_only() -> None:
    store = RecordingStore({"ds-1/v1.parquet": frame()})
    artifact_service.metadata(store, MetadataRequest(source_key="ds-1/v1.parquet"))
    assert store.writes == []
    assert store.deleted_prefixes == []


def test_metadata_surfaces_a_missing_source() -> None:
    store = RecordingStore()
    with pytest.raises(ObjectStoreError):
        artifact_service.metadata(
            store, MetadataRequest(source_key="ds-1/nope.parquet")
        )


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


# ── reclaim (DS-LAKE-009B) ───────────────────────────────────────────────
#
# `RecordingStore.delete_prefix` only tracks the `.objects` dict, not
# `.documents` — a test-fake simplification, not a production behaviour.
# In the real `ObjectStore`, sidecars are just other keys under the same
# prefix in the same bucket, so `delete_prefix` already removes them too;
# that path is proven against real MinIO by `test_object_store.py`'s live
# round trip, not re-proven here against a fake that cannot model it.


def test_reclaim_deletes_the_named_artifact_only() -> None:
    store = RecordingStore(
        {
            "ds-1/artifacts/art-7/data.parquet": frame(),
            "ds-1/artifacts/art-8/data.parquet": frame(),
        }
    )
    result = artifact_service.reclaim_artifact(
        store, ArtifactReclaimRequest(object_key="ds-1/artifacts/art-7/data.parquet")
    )

    assert result == {"prefix": "ds-1/artifacts/art-7/", "deleted": 1}
    assert set(store.objects) == {"ds-1/artifacts/art-8/data.parquet"}


def test_reclaim_is_idempotent() -> None:
    """A retried cleanup pass on an already-reclaimed artifact must not fail —
    this is what lets ArtifactCleanupService retry after a partial failure
    without needing to know which artifacts it already got to."""
    store = RecordingStore({"ds-1/artifacts/art-7/data.parquet": frame()})
    request = ArtifactReclaimRequest(object_key="ds-1/artifacts/art-7/data.parquet")

    first = artifact_service.reclaim_artifact(store, request)
    second = artifact_service.reclaim_artifact(store, request)

    assert first["deleted"] == 1
    assert second["deleted"] == 0


def test_reclaim_refuses_a_key_outside_artifacts() -> None:
    """The opposite guard from cleanup: this must never be pointed at tmp/."""
    with pytest.raises(ValueError, match="committed artifact's data key"):
        ArtifactReclaimRequest(object_key="ds-1/tmp/job-1/1.parquet")


def test_reclaim_refuses_a_sidecar_key() -> None:
    """Only the data key is accepted, not a sidecar beside it — catches a
    copy-paste of the wrong key rather than the intended artifact's."""
    with pytest.raises(ValueError, match="committed artifact's data key"):
        ArtifactReclaimRequest(object_key="ds-1/artifacts/art-7/manifest.json")


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


# ── manifest sidecar (DS-LAKE-003) ───────────────────────────────────────


def _clean_once(store: RecordingStore) -> dict[str, object]:
    return artifact_service.clean(
        store,
        CleanRequest(
            source_key="ds-1/v1.parquet",
            target_key="ds-1/artifacts/a2/data.parquet",
            operations=[CleaningOperation(type="drop_missing")],
        ),
    )


def test_clean_writes_a_manifest_beside_the_data() -> None:
    store = RecordingStore({"ds-1/v1.parquet": frame()})
    _clean_once(store)

    assert "ds-1/artifacts/a2/manifest.json" in store.documents
    # The manifest must not be mistaken for a data object.
    assert "ds-1/artifacts/a2/manifest.json" not in store.objects


def test_manifest_checksum_matches_the_artifact_it_describes() -> None:
    store = RecordingStore({"ds-1/v1.parquet": frame()})
    payload = _clean_once(store)

    manifest = store.documents["ds-1/artifacts/a2/manifest.json"]
    assert isinstance(manifest, dict)
    # A manifest whose checksum disagreed with the response would be worse than
    # no manifest: it would look authoritative while pointing at other bytes.
    assert manifest["checksum"] == payload["checksum"]
    assert manifest["object_key"] == payload["object_key"]
    assert manifest["row_count"] == payload["row_count"]


def test_manifest_records_lineage_and_operations() -> None:
    store = RecordingStore({"ds-1/v1.parquet": frame()})
    _clean_once(store)

    manifest = store.documents["ds-1/artifacts/a2/manifest.json"]
    assert isinstance(manifest, dict)
    # Lineage is the point of the sidecar: an artifact must name its parent so
    # the chain is reconstructible from object storage alone.
    assert manifest["parent_key"] == "ds-1/v1.parquet"
    assert manifest["operations"] == [{"type": "drop_missing"}]
    assert manifest["schema_version"] == 1
    assert manifest["format"] == "parquet"


def test_materialized_artifact_has_no_parent() -> None:
    """A materialised artifact is a lineage ROOT, not a child.

    Recording a parent here would invent a relationship: the frame came from PI
    or SQL, not from another artifact.
    """
    store = RecordingStore()
    stats = ArtifactStats(
        object_key="ds-1/artifacts/a1/data.parquet",
        row_count=6,
        column_count=2,
        size_bytes=1024,
        missing_pct=0.0,
        checksum="b" * 64,
    )
    artifact_service._commit(store, stats, 0.0)

    manifest = store.documents["ds-1/artifacts/a1/manifest.json"]
    assert isinstance(manifest, dict)
    assert manifest["parent_key"] is None
    assert manifest["operations"] == []


# ── column_stats sidecar (DS-LAKE-005B-A-T07) ─────────────────────────────


def test_clean_writes_a_column_stats_sidecar_beside_the_data() -> None:
    store = RecordingStore({"ds-1/v1.parquet": frame()})
    payload = _clean_once(store)

    key = "ds-1/artifacts/a2/column_stats.json"
    assert key in store.documents
    assert key not in store.objects  # not mistaken for a data object
    assert payload["column_stats_key"] == key


def test_column_stats_sidecar_has_one_entry_per_tag_with_drift_against_the_parent() -> None:
    store = RecordingStore({"ds-1/v1.parquet": frame()})
    _clean_once(store)

    stats = store.documents["ds-1/artifacts/a2/column_stats.json"]
    assert set(stats.keys()) == {"TI-101"}
    entry = stats["TI-101"]
    # drop_missing removed the one Bad row, so the cleaned frame is 100% Good
    # and identical in value to the parent's Good cells — drift near zero.
    assert entry["cleaned"] is True
    assert entry["drift"] == pytest.approx(0.0, abs=1e-6)
    assert entry["coverage"] == 100.0


def test_a_lineage_root_gets_null_drift_not_zero() -> None:
    """No parent to compare against — drift is None, not 0. Exercised at the
    same level `test_materialized_artifact_has_no_parent` already uses
    (`_commit` directly): `materialize()`'s own PI/SQL fetch needs a live
    source to unit test meaningfully, but the column-stats behaviour this
    test pins is entirely about `_commit`/`build_column_stats`, which
    `materialize()` calls with `parent_frame=None` regardless of source.
    """
    from services.column_stats_service import build_column_stats

    store = RecordingStore()
    stats = ArtifactStats(
        object_key="ds-1/artifacts/a1/data.parquet",
        row_count=6,
        column_count=2,
        size_bytes=1024,
        missing_pct=0.0,
        checksum="b" * 64,
    )
    column_stats = build_column_stats(frame(), operations=[])
    artifact_service._commit(store, stats, 0.0, column_stats=column_stats)

    sidecar = store.documents["ds-1/artifacts/a1/column_stats.json"]
    assert sidecar["TI-101"]["drift"] is None
    assert sidecar["TI-101"]["cleaned"] is False


# ── column_stats read (DS-LAKE-005B-A-T07/V07) ────────────────────────────


def test_column_stats_read_serves_the_sidecar_without_opening_the_data() -> None:
    """V07's literal claim, AT the literal 8,000-tag scale it names: data.parquet
    is never opened to answer a column-stats request — instrumented on the
    object store itself (get_frame_calls), not inferred from reading the
    code."""
    eight_thousand_tags = [f"TAG-{i}" for i in range(8_000)]
    store = RecordingStore({"ds-1/v1.parquet": many_tags_frame(eight_thousand_tags)})
    _clean_once_many_tags(store)

    before = store.get_frame_calls  # the clean() above already read once
    result = artifact_service.column_stats(
        store, ColumnStatsRequest(source_key="ds-1/artifacts/a2/data.parquet")
    )

    assert store.get_frame_calls == before  # unchanged — no frame was read
    assert len(result["stats"]) == 8_000
    assert set(result["stats"].keys()) == set(eight_thousand_tags)


def test_column_stats_read_surfaces_a_missing_sidecar() -> None:
    """A legacy artifact with no sidecar — 422 via the existing except-chain,
    not a silent empty page and not a compute-on-read fallback (which would
    open data.parquet and defeat the point of the sidecar)."""
    store = RecordingStore({"ds-1/v1.parquet": frame()})
    with pytest.raises(ObjectStoreError):
        artifact_service.column_stats(
            store, ColumnStatsRequest(source_key="ds-1/v1.parquet")
        )


def _clean_once_many_tags(store: "RecordingStore") -> dict[str, object]:
    return artifact_service.clean(
        store,
        CleanRequest(
            source_key="ds-1/v1.parquet",
            target_key="ds-1/artifacts/a2/data.parquet",
            operations=[],
        ),
    )


# ── router contract: /rows format=arrow (DS-LAKE-005B-A-T05) ─────────────
#
# `test_preview_service.py` established why this matters: the handler's
# except-chain ends in `except Exception -> 502`, so if the arrow branch
# ever bypassed `_run`, an unknown tag would turn from a caller-fixable 422
# into a 502 with a server-side traceback. This is the sibling of that
# file's `test_unknown_preview_tag_is_422_not_502`, for `/rows`.


@pytest.fixture()
def client():
    from fastapi.testclient import TestClient

    from dependencies import get_object_store
    from main import app

    store = RecordingStore({"ds-1/v1.parquet": wide_frame()})
    app.dependency_overrides[get_object_store] = lambda: store
    try:
        yield TestClient(app), store
    finally:
        app.dependency_overrides.pop(get_object_store, None)


def test_rows_arrow_unknown_tag_is_422_not_502(client) -> None:
    http, _ = client
    response = http.post(
        "/v1/preprocess/rows",
        json={"source_key": "ds-1/v1.parquet", "tags": ["NOPE-1"], "format": "arrow"},
    )
    assert response.status_code == 422


def test_rows_arrow_route_returns_the_documented_content_type_and_headers() -> None:
    import pyarrow as pa
    from fastapi.testclient import TestClient

    from dependencies import get_object_store
    from main import app

    store = RecordingStore({"ds-1/v1.parquet": wide_frame()})
    app.dependency_overrides[get_object_store] = lambda: store
    try:
        response = TestClient(app).post(
            "/v1/preprocess/rows",
            json={"source_key": "ds-1/v1.parquet", "offset": 0, "limit": 3, "format": "arrow"},
        )
    finally:
        app.dependency_overrides.pop(get_object_store, None)

    assert response.status_code == 200
    assert response.headers["content-type"] == "application/vnd.apache.arrow.stream"
    assert response.headers["x-total-row-count"] == "6"
    assert response.headers["x-offset"] == "0"
    assert response.headers["x-filtered"] == "false"

    table = pa.ipc.open_stream(response.content).read_all()
    assert table.num_rows == 3


def test_rows_route_still_returns_json_when_format_is_omitted(client) -> None:
    """Every existing caller sends no `format` at all — this pins that the
    default stays the JSON body they already parse, unchanged by T05."""
    http, _ = client
    response = http.post(
        "/v1/preprocess/rows",
        json={"source_key": "ds-1/v1.parquet", "offset": 0, "limit": 3},
    )
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("application/json")
    body = response.json()
    assert "rows" in body and "total_row_count" in body
