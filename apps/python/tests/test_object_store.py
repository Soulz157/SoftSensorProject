"""Storage-layer guards for dataset version artifacts.

Split in two on purpose:

* **Pure structural guards** run everywhere with no network. They protect the
  invariants that would otherwise cause silent data loss.
* **Live round-trip** touches MinIO and skips cleanly when it is unreachable,
  so the suite still passes on a machine without object storage.
"""

from __future__ import annotations

import pandas as pd
import pytest

from intergrations.object_store import (
    STATUS_BAD,
    STATUS_GOOD,
    STATUS_QUESTIONABLE,
    STATUS_SUFFIX,
    TMP_LIFECYCLE_EXPIRY_DAYS,
    TMP_LIFECYCLE_RULE_ID,
    ObjectStore,
    ObjectStoreError,
    assert_frame_shape,
    assert_tags_are_storable,
    missing_pct,
    tag_columns,
    tmp_key,
    tmp_prefix,
    version_key,
)

TS = pd.to_datetime(["2026-06-22 00:00:00", "2026-06-22 00:01:00"])


def frame(**columns) -> pd.DataFrame:
    """Two-row frame with an explicit timestamp column."""
    data: dict = {"timestamp": TS}
    data.update(columns)
    return pd.DataFrame(data)


def good_frame() -> pd.DataFrame:
    return pd.DataFrame(
        {
            "timestamp": TS,
            "TI-101": [72.4, 73.1],
            "TI-101__status": pd.array([STATUS_GOOD, STATUS_BAD], dtype="int8"),
            "FI-404": [120.0, 121.0],
            "FI-404__status": pd.array([STATUS_GOOD, STATUS_GOOD], dtype="int8"),
        }
    )


# ── column accounting ────────────────────────────────────────────────────


def test_tag_columns_counts_logical_tags_only() -> None:
    """2N+1 physical columns must report as N logical tags.

    DatasetVersion.columnCount and the preview's feature count both read this;
    if they disagree the UI shows two different numbers for one dataset.
    """
    df = good_frame()
    assert len(df.columns) == 5
    assert tag_columns(df) == ["TI-101", "FI-404"]


def test_missing_pct_counts_non_good_cells() -> None:
    # 1 Bad out of 4 tag cells.
    assert missing_pct(good_frame()) == 25.0


def test_missing_pct_of_empty_frame_is_zero() -> None:
    assert missing_pct(pd.DataFrame({"timestamp": []})) == 0.0


# ── structural guards ────────────────────────────────────────────────────


def test_valid_frame_passes() -> None:
    assert_frame_shape(good_frame())


def test_tag_named_like_a_status_column_is_rejected() -> None:
    """The regression this file exists for.

    A tag literally named `FOO__status` is not merely a collision: `tag_columns`
    classifies it as a sidecar, so it VANISHES from the dataset with no error.
    Checking the filtered tag list cannot catch this — the offender is already
    gone by then — so the frame itself is validated.
    """
    df = frame(
        **{
            "FOO": [1.0, 2.0],
            "FOO__status": [3.0, 4.0],
            "FOO__status__status": pd.array([0, 0], dtype="int8"),
        }
    )
    with pytest.raises(ValueError):
        assert_frame_shape(df)


def test_orphan_status_column_is_rejected() -> None:
    df = frame(**{"GHOST__status": pd.array([0, 0], dtype="int8")})
    with pytest.raises(ValueError, match="no matching tag"):
        assert_frame_shape(df)


def test_tag_without_status_sidecar_is_rejected() -> None:
    """Cleaning ops read status; a missing sidecar would read as all-Good."""
    with pytest.raises(ValueError, match="no quality column"):
        assert_frame_shape(frame(**{"TI-101": [1.0, 2.0]}))


def test_frame_without_timestamp_is_rejected() -> None:
    df = pd.DataFrame({"TI-101": [1.0], "TI-101__status": pd.array([0], dtype="int8")})
    with pytest.raises(ValueError, match="timestamp"):
        assert_frame_shape(df)


def test_source_tag_list_guard_rejects_reserved_suffix() -> None:
    assert_tags_are_storable(["TI-101", "FI-404"])
    with pytest.raises(ValueError, match=STATUS_SUFFIX):
        assert_tags_are_storable(["TI-101", "FOO__status"])


# ── key helpers ──────────────────────────────────────────────────────────


def test_key_helpers_are_scoped_by_dataset() -> None:
    assert version_key("ds1", "v9") == "ds1/v9.parquet"
    assert tmp_key("ds1", "job7", 2) == "ds1/tmp/job7/2.parquet"
    assert tmp_prefix("ds1", "job7") == "ds1/tmp/job7/"
    # Intermediates sit under the dataset prefix but must never look like a
    # committed version key.
    assert tmp_key("ds1", "job7", 2).startswith("ds1/")
    assert not tmp_key("ds1", "job7", 2).endswith("/v9.parquet")


def test_status_codes_are_distinct() -> None:
    assert len({STATUS_GOOD, STATUS_BAD, STATUS_QUESTIONABLE}) == 3


# ── live MinIO ───────────────────────────────────────────────────────────


@pytest.fixture(scope="module")
def store() -> ObjectStore:
    try:
        s = ObjectStore()
        s.ensure_bucket()
        return s
    except Exception as err:  # noqa: BLE001 - any transport failure means skip
        pytest.skip(f"MinIO unreachable, skipping live storage tests: {err}")


def test_round_trip_preserves_values_and_status(store: ObjectStore) -> None:
    df = good_frame()
    key = "pytest-object-store/round-trip.parquet"

    stats = store.put_frame(df, key, overwrite=True)
    assert stats.row_count == 2
    assert stats.column_count == 2  # logical tags, not the 5 physical columns
    assert stats.missing_pct == 25.0
    assert stats.size_bytes > 0

    back = store.get_frame(key)
    assert back.equals(df)
    # int8 matters: status as strings would bloat artifacts at millions of rows.
    assert str(back["TI-101__status"].dtype) == "int8"

    store.delete_prefix("pytest-object-store/")


def test_committed_artifacts_are_immutable(store: ObjectStore) -> None:
    df = good_frame()
    key = "pytest-object-store/immutable.parquet"
    store.put_frame(df, key, overwrite=True)

    with pytest.raises(ObjectStoreError, match="immutable"):
        store.put_frame(df, key)

    store.delete_prefix("pytest-object-store/")


def test_tmp_intermediates_may_be_overwritten(store: ObjectStore) -> None:
    """Job retry rewrites its own tmp step; only committed keys are frozen."""
    df = good_frame()
    key = tmp_key("pytest-object-store", "job-1", 1)

    store.put_frame(df, key, overwrite=True)
    store.put_frame(df, key, overwrite=True)

    assert store.delete_prefix(tmp_prefix("pytest-object-store", "job-1")) == 1


def test_get_frame_slice_windows_rows(store: ObjectStore) -> None:
    df = good_frame()
    key = "pytest-object-store/slice.parquet"
    store.put_frame(df, key, overwrite=True)

    window = store.get_frame_slice(key, offset=1, limit=1)
    assert len(window) == 1
    assert window["TI-101"].tolist() == [73.1]

    with pytest.raises(ValueError):
        store.get_frame_slice(key, offset=-1, limit=1)
    with pytest.raises(ValueError):
        store.get_frame_slice(key, offset=0, limit=0)

    store.delete_prefix("pytest-object-store/")


def test_get_frame_metadata_reads_tags_and_range_without_decoding_values(
    store: ObjectStore,
) -> None:
    """DS-LAKE-005B-A-T01: the footer-driven path, against a real Parquet
    object — the RecordingStore fake in `test_artifact_service.py` proves the
    service wiring, this proves the actual pyarrow read.
    """
    df = good_frame()
    key = "pytest-object-store/metadata.parquet"
    store.put_frame(df, key, overwrite=True)

    meta = store.get_frame_metadata(key)

    # Alphabetical, not schema/file-column order (FI-404 is written second in
    # good_frame() but must sort first) — /metadata and /tags must agree.
    assert meta["tags"] == ["FI-404", "TI-101"]
    # timestamp + 2 tags + 2 status sidecars (2N+1 for N=2)
    assert meta["column_count"] == 5
    assert meta["row_count"] == 2
    assert meta["start_time"] == "2026-06-22 00:00:00"
    assert meta["end_time"] == "2026-06-22 00:01:00"

    store.delete_prefix("pytest-object-store/")


def test_get_frame_column_projection_excludes_the_other_tag(
    store: ObjectStore,
) -> None:
    """DS-LAKE-005B-A-T02: real Parquet column projection, and the real
    rejection type an unknown column raises — `artifact_service.rows` relies
    on this being a `ValueError` subclass to turn a bad tag name into a 422.
    """
    df = good_frame()
    key = "pytest-object-store/projection.parquet"
    store.put_frame(df, key, overwrite=True)

    projected = store.get_frame(key, columns=["timestamp", "TI-101"])
    assert list(projected.columns) == ["timestamp", "TI-101"]
    assert "FI-404" not in projected.columns

    with pytest.raises(ValueError):
        store.get_frame(key, columns=["timestamp", "NOPE"])

    store.delete_prefix("pytest-object-store/")


# ── lifecycle (DS-LAKE-009B-T04) ─────────────────────────────────────────


def test_tmp_writes_are_tagged_for_lifecycle_expiry(store: ObjectStore) -> None:
    """A tmp/ write must carry the tag `ensure_tmp_lifecycle_rule`'s bucket
    rule matches on — a committed artifact write must NOT, or the bucket
    rule would expire real data."""
    df = good_frame()
    tmp = tmp_key("pytest-object-store", "job-lifecycle", 1)
    committed = "pytest-object-store/artifacts/art-1/data.parquet"

    store.put_frame(df, tmp, overwrite=True)
    store.put_frame(df, committed, overwrite=True)

    tmp_tags = store._client.get_object_tags(store.bucket, tmp)
    committed_tags = store._client.get_object_tags(store.bucket, committed)

    assert tmp_tags is not None and dict(tmp_tags) == {"lifecycle": "tmp"}
    assert not committed_tags

    store.delete_prefix("pytest-object-store/")


def test_ensure_tmp_lifecycle_rule_is_idempotent(store: ObjectStore) -> None:
    """Re-running the bootstrap must not accumulate duplicate rules — it is
    meant to be safe to call on every deploy, not just once ever."""
    store.ensure_tmp_lifecycle_rule()
    first = store._client.get_bucket_lifecycle(store.bucket)

    store.ensure_tmp_lifecycle_rule()
    second = store._client.get_bucket_lifecycle(store.bucket)

    matching = [r for r in second.rules if r.rule_id == TMP_LIFECYCLE_RULE_ID]
    assert len(matching) == 1
    assert matching[0].expiration.days == TMP_LIFECYCLE_EXPIRY_DAYS
    assert len(second.rules) == len(first.rules)
