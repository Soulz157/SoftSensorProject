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
    COLUMN_STATS_FILENAME,
    DATA_FILENAME,
    DATA_FILENAME_BY_TYPE,
    STATUS_BAD,
    STATUS_GOOD,
    STATUS_QUESTIONABLE,
    STATUS_SUFFIX,
    TMP_LIFECYCLE_EXPIRY_DAYS,
    TMP_LIFECYCLE_RULE_ID,
    ObjectNotFoundError,
    ObjectStore,
    ObjectStoreError,
    artifact_key,
    artifact_prefix,
    assert_frame_shape,
    assert_tags_are_storable,
    draft_run_key,
    draft_run_prefix,
    draft_runs_prefix,
    is_committed_artifact_key,
    is_draft_run_key,
    is_draft_run_prefix,
    is_model_run_key,
    manifest_key,
    MANIFEST_FILENAME,
    missing_pct,
    model_run_key,
    sidecar_key,
    split_data_key,
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


# ── stage-suffixed data filenames (DS-LAKE-016) ─────────────────────────


def test_artifact_key_defaults_to_legacy_name_when_type_omitted() -> None:
    """Every existing caller keeps compiling and keeps producing the OLD
    name until explicitly updated — the widening's whole premise."""
    assert artifact_key("ds1", "a1") == "ds1/artifacts/a1/data.parquet"


def test_artifact_key_is_stage_suffixed_for_bronze_silver_gold() -> None:
    assert artifact_key("ds1", "a1", "BRONZE") == "ds1/artifacts/a1/data_bronze.parquet"
    assert artifact_key("ds1", "a1", "SILVER") == "ds1/artifacts/a1/data_silver.parquet"
    assert artifact_key("ds1", "a1", "GOLD") == "ds1/artifacts/a1/data_gold.parquet"


def test_artifact_key_final_falls_back_to_legacy_name() -> None:
    """FINAL never gets a file of its own — DATA_FILENAME_BY_TYPE has no
    FINAL entry, and this must not raise for an unknown/absent type."""
    assert artifact_key("ds1", "a1", "FINAL") == artifact_key("ds1", "a1")


def test_split_data_key_recognises_every_accepted_filename() -> None:
    for filename in (DATA_FILENAME, *DATA_FILENAME_BY_TYPE.values()):
        key = f"ds1/artifacts/a1/{filename}"
        assert split_data_key(key) == ("ds1/artifacts/a1/", filename)


def test_split_data_key_rejects_a_non_data_key() -> None:
    assert split_data_key("ds1/artifacts/a1/manifest.json") is None
    assert split_data_key("ds1/tmp/job1/1.parquet") is None


def test_sidecar_key_resolves_to_the_same_location_for_every_accepted_data_filename() -> (
    None
):
    """DS-LAKE-016-T05's own acceptance criterion, literally: sidecars must
    not depend on WHICH spelling the data file carries."""
    expected = "ds1/artifacts/a1/manifest.json"
    for filename in (DATA_FILENAME, *DATA_FILENAME_BY_TYPE.values()):
        data_key = f"ds1/artifacts/a1/{filename}"
        assert sidecar_key(data_key, "manifest.json") == expected
        assert sidecar_key(data_key, "manifest.json") == manifest_key("ds1", "a1")


def test_sidecar_key_falls_back_to_a_dotted_suffix_for_a_non_artifact_key() -> None:
    """Legacy/tmp keys are not in the artifact layout at all — must still
    get a manifest, not silently none, per the function's own doc comment."""
    assert (
        sidecar_key("ds1/tmp/job1/1.parquet", "manifest.json")
        == "ds1/tmp/job1/1.parquet.manifest.json"
    )


def test_is_committed_artifact_key_accepts_legacy_and_every_stage_suffix() -> None:
    for filename in (DATA_FILENAME, *DATA_FILENAME_BY_TYPE.values()):
        assert is_committed_artifact_key(f"ds1/artifacts/a1/{filename}")


def test_is_committed_artifact_key_rejects_tmp_and_sidecar_keys() -> None:
    assert not is_committed_artifact_key("ds1/tmp/job1/1.parquet")
    assert not is_committed_artifact_key("ds1/artifacts/a1/manifest.json")
    assert not is_committed_artifact_key("ds1/v1.parquet")  # legacy version key


def test_export_key_reclaims_only_its_own_artifact_directory() -> None:
    """DS-LAKE-021-T04 regression. An EXPORT used to derive its key via
    `sidecar_key(source_key, EXPORT_CSV_FILENAME)` — landing INSIDE the
    SOURCE artifact's own directory. Reclaiming it then would have deleted
    the source's own data.parquet too. An EXPORT now owns its own
    artifact-id-keyed key, same as every other committed type —
    `split_data_key`'s derived prefix (what `reclaim_artifact` deletes)
    must stay scoped to ONLY the export's own directory, never a
    different artifact's."""
    export_key = "ds1/artifacts/export-1/export.csv"
    source_prefix = "ds1/artifacts/final-1/"  # a DIFFERENT artifact

    assert is_committed_artifact_key(export_key)
    prefix, filename = split_data_key(export_key)
    assert filename == "export.csv"
    assert prefix == "ds1/artifacts/export-1/"
    # The hazard this test exists to catch: the derived prefix must never
    # equal a different artifact's own directory.
    assert prefix != source_prefix


# ── model-run key guard (MODEL-FLOW-000-T09) ────────────────────────────────


def test_is_model_run_key_accepts_well_formed_keys() -> None:
    assert is_model_run_key(model_run_key("m1", "r1", "model.joblib"))
    assert is_model_run_key("models/m1/runs/r1/model.joblib")


def test_is_model_run_key_rejects_traversal_and_malformed_segments() -> None:
    """Structural, not substring: startswith('models/') and '/runs/' in key
    used to accept 'models/../../x/runs/y/z' — this is the regression that
    guard exists to close."""
    assert not is_model_run_key("models/../../x/runs/r1/model.joblib")
    assert not is_model_run_key("models/../runs/r1/model.joblib")
    assert not is_model_run_key("models/m1/runs/../r1/model.joblib")
    assert not is_model_run_key("models//runs/r1/model.joblib")
    assert not is_model_run_key("models/m1/runs/r1/sub/model.joblib")
    assert not is_model_run_key("models/m1/notruns/r1/model.joblib")
    assert not is_model_run_key("models/m1/runs//model.joblib")
    assert not is_model_run_key("not-models/m1/runs/r1/model.joblib")


def test_is_draft_run_key_accepts_well_formed_keys() -> None:
    assert is_draft_run_key(draft_run_key("d1", "r1", "model.joblib"))
    assert is_draft_run_key("drafts/d1/runs/r1/model.joblib")


def test_is_draft_run_key_rejects_traversal_and_malformed_segments() -> None:
    """Same structural predicate as is_model_run_key, rooted at drafts/ —
    see that function's own regression test for what this closes."""
    assert not is_draft_run_key("drafts/../../x/runs/r1/model.joblib")
    assert not is_draft_run_key("drafts/../runs/r1/model.joblib")
    assert not is_draft_run_key("drafts/d1/runs/../r1/model.joblib")
    assert not is_draft_run_key("drafts//runs/r1/model.joblib")
    assert not is_draft_run_key("drafts/d1/runs/r1/sub/model.joblib")
    assert not is_draft_run_key("drafts/d1/notruns/r1/model.joblib")
    assert not is_draft_run_key("drafts/d1/runs//model.joblib")
    assert not is_draft_run_key("not-drafts/d1/runs/r1/model.joblib")
    # Cross-root: a model-shaped key must not satisfy the draft predicate,
    # and vice versa — the two roots are never interchangeable.
    assert not is_draft_run_key("models/m1/runs/r1/model.joblib")
    assert not is_model_run_key("drafts/d1/runs/r1/model.joblib")


def test_is_draft_run_prefix_accepts_both_a_run_prefix_and_a_drafts_subtree() -> None:
    """MODEL-FLOW-011-T02. Unlike is_draft_run_key (filename-terminated,
    exactly 4 segments), this accepts either the 3-segment run prefix or the
    2-segment whole-subtree prefix — both directory-terminated."""
    assert is_draft_run_prefix(draft_run_prefix("d1", "r1"))
    assert is_draft_run_prefix("drafts/d1/runs/r1/")
    assert is_draft_run_prefix(draft_runs_prefix("d1"))
    assert is_draft_run_prefix("drafts/d1/runs/")


def test_is_draft_run_prefix_rejects_a_bare_draft_prefix() -> None:
    """The hazard this predicate exists to prevent: drafts/ is a shared root
    for ModelDraft run objects AND DatasetDraft artifact objects. A bare
    drafts/{draft_id}/ prefix reaches BOTH — this must never validate."""
    assert not is_draft_run_prefix("drafts/d1/")
    assert not is_draft_run_prefix("drafts/d1")


def test_is_draft_run_prefix_rejects_traversal_missing_slash_and_wrong_root() -> None:
    assert not is_draft_run_prefix("drafts/../runs/r1/")
    assert not is_draft_run_prefix("drafts/d1/runs/../")
    assert not is_draft_run_prefix("drafts/d1/runs/r1")  # no trailing slash
    assert not is_draft_run_prefix("drafts/d1/notruns/r1/")
    assert not is_draft_run_prefix("drafts//runs/r1/")
    assert not is_draft_run_prefix("drafts/d1/runs//")
    assert not is_draft_run_prefix("models/m1/runs/r1/")
    assert not is_draft_run_prefix("drafts/d1/artifacts/a1/")  # DatasetDraft shape


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


def test_stage_suffixed_write_round_trips_data_and_sidecar(
    store: ObjectStore,
) -> None:
    """DS-LAKE-016-T05/V01: write one real artifact per stage against real
    MinIO, confirm the object name is actually stage-suffixed, then read the
    data AND its manifest sidecar back through the derived key — the whole
    point of naming the stage into the file is that a reader can still find
    everything beside it."""
    df = good_frame()
    dataset_id = "pytest-object-store"

    for artifact_type, filename in DATA_FILENAME_BY_TYPE.items():
        artifact_id = f"stage-{artifact_type.lower()}"
        key = artifact_key(dataset_id, artifact_id, artifact_type)
        assert key == f"{dataset_id}/artifacts/{artifact_id}/{filename}"

        store.put_frame(df, key, overwrite=True)
        manifest = sidecar_key(key, "manifest.json")
        assert manifest == manifest_key(dataset_id, artifact_id)
        store.put_json(manifest, {"stage": artifact_type})

        back = store.get_frame(key)
        assert back.equals(df)
        assert store.get_json(manifest) == {"stage": artifact_type}

    store.delete_prefix(f"{dataset_id}/artifacts/")


def test_reclaim_a_real_stage_suffixed_artifact_deletes_a_non_zero_count(
    store: ObjectStore,
) -> None:
    """DS-LAKE-016-T05/V02: the live counterpart of the RecordingStore-based
    unit test in test_artifact_service.py — a prefix bug here reports
    success and deletes nothing, so `deleted > 0` plus a real `exists()`
    check is asserted, not just "no error"."""
    df = good_frame()
    dataset_id = "pytest-object-store"
    artifact_id = "reclaim-gold"
    key = artifact_key(dataset_id, artifact_id, "GOLD")

    store.put_frame(df, key, overwrite=True)
    prefix, _ = split_data_key(key)
    assert prefix == f"{dataset_id}/artifacts/{artifact_id}/"

    deleted = store.delete_prefix(prefix)

    assert deleted > 0
    assert not store.exists(key)


def test_reclaim_one_draft_run_leaves_its_sibling_run_readable(
    store: ObjectStore,
) -> None:
    """MODEL-FLOW-011-T05, proved by deletion rather than by assertion that a
    mocked call was never made. Two run prefixes under one draft; reclaim
    ONE by {draft_id, run_id}, then assert the survivor — standing in for an
    adopted run's objects, which the sweep must never even name — is still
    readable AFTER the tick that reclaimed its sibling. A mock-based Nest
    spec can show "postToPython was never called with it"; only a real
    delete against the survivor's neighbour can show the delete itself is
    correctly scoped to just the one prefix."""
    df = good_frame()
    draft_id = "pytest-object-store-draft-t05"
    reclaimed_run = "run-reclaimed"
    surviving_run = "run-adopted"

    reclaimed_key = draft_run_key(draft_id, reclaimed_run, "model.joblib")
    surviving_key = draft_run_key(draft_id, surviving_run, "model.joblib")
    store.put_frame(df, reclaimed_key, overwrite=True)
    store.put_frame(df, surviving_key, overwrite=True)

    prefix = draft_run_prefix(draft_id, reclaimed_run)
    assert is_draft_run_prefix(prefix)

    deleted = store.delete_prefix(prefix)

    assert deleted > 0
    assert not store.exists(reclaimed_key)
    assert store.exists(surviving_key)

    store.delete_prefix(draft_runs_prefix(draft_id))


def test_reclaim_draft_runs_subtree_removes_every_run_including_an_orphan(
    store: ObjectStore,
) -> None:
    """MODEL-FLOW-011-T02: the subtree-delete branch, used whenever no run on
    a draft is adopted — also the one shape that reaches a run prefix whose
    ModelTrainingRun row is already gone (an orphan the row-driven per-run
    branch could never name). Two run prefixes, no Postgres row assumed for
    either; one subtree call must remove both."""
    df = good_frame()
    draft_id = "pytest-object-store-draft-t02-subtree"
    run_a = draft_run_key(draft_id, "run-a", "model.joblib")
    run_b = draft_run_key(draft_id, "run-b", "metrics.json")
    store.put_frame(df, run_a, overwrite=True)
    store.put_json(run_b, {"rmse": 1.0})

    subtree = draft_runs_prefix(draft_id)
    assert is_draft_run_prefix(subtree)

    deleted = store.delete_prefix(subtree)

    assert deleted == 2
    assert not store.exists(run_a)
    assert not store.exists(run_b)


def test_pre_existing_legacy_named_artifact_still_reads_end_to_end(
    store: ObjectStore,
) -> None:
    """DS-LAKE-016-V03: the WIDENING claim, tested rather than asserted. A
    real object written the OLD way (no artifact_type — every artifact
    committed before this feature) must still round-trip data + sidecar +
    reclaim identically after the change. Pre-existing objects can never be
    renamed (findings), so this path must never regress."""
    df = good_frame()
    dataset_id = "pytest-object-store"
    artifact_id = "legacy-artifact"
    key = artifact_key(dataset_id, artifact_id)  # no type -> legacy data.parquet
    assert key == f"{dataset_id}/artifacts/{artifact_id}/data.parquet"

    store.put_frame(df, key, overwrite=True)
    manifest = sidecar_key(key, "manifest.json")
    store.put_json(manifest, {"legacy": True})

    assert is_committed_artifact_key(key)
    back = store.get_frame(key)
    assert back.equals(df)
    assert store.get_json(manifest) == {"legacy": True}

    prefix, _ = split_data_key(key)
    assert store.delete_prefix(prefix) > 0
    assert not store.exists(key)


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


def test_get_frame_slice_duckdb_matches_get_frame_slice(store: ObjectStore) -> None:
    """DS-LAKE-005B-C-V01: golden parity — the DuckDB-native path returns the
    SAME selected rows, values and ordering as the existing pandas-slice
    path, for the same (key, offset, limit).

    20 rows, 2 tags (one with a non-Good status mixed in) and several
    overlapping/edge-case windows — enough to be a real ordering claim, not
    just "the first row matches." Exercises: a window fully inside the
    frame, a window starting mid-frame, a window whose limit runs past the
    end of the frame, and offset=0.
    """
    n = 20
    df = pd.DataFrame(
        {
            "timestamp": pd.date_range("2026-06-01", periods=n, freq="min"),
            "TI-101": [70.0 + i * 0.5 for i in range(n)],
            "TI-101__status": pd.array(
                [STATUS_GOOD if i % 4 != 3 else STATUS_BAD for i in range(n)],
                dtype="int8",
            ),
            "FI-404": [100.0 + i for i in range(n)],
            "FI-404__status": pd.array(
                [STATUS_GOOD if i % 5 != 4 else STATUS_QUESTIONABLE for i in range(n)],
                dtype="int8",
            ),
        }
    )
    key = "pytest-object-store/parity.parquet"
    store.put_frame(df, key, overwrite=True)

    windows = [(0, 5), (7, 5), (15, 10), (0, 100), (19, 1)]
    for offset, limit in windows:
        pandas_path = store.get_frame_slice(key, offset=offset, limit=limit)
        duckdb_path = store.get_frame_slice_duckdb(key, offset=offset, limit=limit)

        assert list(pandas_path.columns) == list(duckdb_path.columns), (
            f"column order differs at offset={offset} limit={limit}"
        )
        pd.testing.assert_frame_equal(
            pandas_path.reset_index(drop=True),
            duckdb_path.reset_index(drop=True),
        )

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


# ── DS-LAKE-025: copy_prefix + the typed missing-object error ────────────────
#
# Save Dataset copies a draft's committed artifact into the dataset's own
# prefix so a saved dataset never depends on a `drafts/` object it does not
# own. Two saved datasets were found with their draft objects already gone —
# DatasetArtifact rows live, `objectReclaimedAt` null, MinIO answering
# NoSuchKey — which is the failure these tests pin closed.


def test_missing_object_raises_the_typed_subclass(store: ObjectStore) -> None:
    """A NoSuchKey is distinguishable, and still an ObjectStoreError.

    The subclass is what lets `routers/preprocess._run` answer 404 for "the
    bytes are gone" while keeping 422 for "storage refused the read" — two
    failures with different remedies that used to be one 400 carrying a raw
    MinIO string.
    """
    missing = "pytest-object-store/definitely-absent/data.parquet"

    with pytest.raises(ObjectNotFoundError) as excinfo:
        store.get_object_bytes(missing)

    assert isinstance(excinfo.value, ObjectStoreError)
    # Message text is unchanged from before the split, on purpose.
    assert str(excinfo.value) == f"Could not read '{missing}': NoSuchKey"


def test_copy_prefix_moves_data_and_every_sidecar(store: ObjectStore) -> None:
    src = "pytest-object-store/src-artifact/"
    dst = "pytest-object-store/dst-artifact/"
    store.put_frame(good_frame(), f"{src}{DATA_FILENAME}", overwrite=True)
    store.put_json(f"{src}{MANIFEST_FILENAME}", {"n": 1})
    store.put_json(f"{src}{COLUMN_STATS_FILENAME}", {"TI-101": {}})

    copied = store.copy_prefix(src, dst)

    # Sidecars travel too: readers derive their keys FROM the data key, so a
    # copy that moved only the parquet would repoint the row at a data file
    # whose sidecars still 404.
    assert sorted(copied) == [
        f"{dst}{COLUMN_STATS_FILENAME}",
        f"{dst}{DATA_FILENAME}",
        f"{dst}{MANIFEST_FILENAME}",
    ]
    assert store.get_frame(f"{dst}{DATA_FILENAME}").equals(good_frame())
    assert store.get_json(f"{dst}{MANIFEST_FILENAME}") == {"n": 1}
    # Byte-identical, not re-encoded — the artifact row's recorded checksum
    # has to keep matching the object it now points at.
    assert store.checksum_of(f"{dst}{DATA_FILENAME}") == store.checksum_of(
        f"{src}{DATA_FILENAME}"
    )
    # The source is left alone: removing it is cleanup's job, never Save's.
    assert store.exists(f"{src}{DATA_FILENAME}")

    store.delete_prefix("pytest-object-store/")


def test_copy_prefix_is_idempotent(store: ObjectStore) -> None:
    """A retried Save converges instead of failing on the second attempt."""
    src = "pytest-object-store/src-idem/"
    dst = "pytest-object-store/dst-idem/"
    store.put_frame(good_frame(), f"{src}{DATA_FILENAME}", overwrite=True)

    first = store.copy_prefix(src, dst)
    second = store.copy_prefix(src, dst)

    assert first == second == [f"{dst}{DATA_FILENAME}"]

    store.delete_prefix("pytest-object-store/")


def test_copy_prefix_onto_itself_is_a_listing(store: ObjectStore) -> None:
    """An already-dataset-owned artifact degenerates to a no-op.

    `adopt_artifact` relies on this instead of branching: every object
    already exists at its own destination, so nothing is copied and the call
    reduces to reporting what is there.
    """
    prefix = artifact_prefix("pytest-object-store", "self-adopt")
    store.put_frame(good_frame(), f"{prefix}{DATA_FILENAME}", overwrite=True)

    assert store.copy_prefix(prefix, prefix) == [f"{prefix}{DATA_FILENAME}"]
    assert store.exists(f"{prefix}{DATA_FILENAME}")

    store.delete_prefix("pytest-object-store/")


def test_copy_prefix_refuses_prefixes_without_a_trailing_slash() -> None:
    """Guards the relative-name split.

    Without the trailing slash the `src_key[len(src_prefix):]` split cuts a
    filename FRAGMENT — the same shape of defect DS-LAKE-016-T02 fixed in
    `reclaim_artifact`, where a stage-suffixed key left `.../data_` behind
    and silently matched nothing. Refusing loudly beats copying to a
    plausible-looking wrong key.
    """
    s = ObjectStore.__new__(ObjectStore)  # no transport needed to hit the guard

    with pytest.raises(ValueError, match="trailing slash|directory-style"):
        ObjectStore.copy_prefix(s, "a/b", "c/d/")
    with pytest.raises(ValueError, match="trailing slash|directory-style"):
        ObjectStore.copy_prefix(s, "a/b/", "c/d")
