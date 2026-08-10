"""DS-LAKE-005B-A-T07: column stats computation, tested standalone before any
write/read endpoint exists to call it — same discipline as T06's downsample
core, since this vocabulary (coverage/outlier_count/drift/cleaned) has no
precedent anywhere in the repo and needs its own definitions pinned by tests,
not assumed correct from the docstring alone.
"""

from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from intergrations.object_store import STATUS_BAD, STATUS_GOOD
from schemas.preprocess import CleaningOperation
from services.column_stats_service import build_column_stats, percentile_bounds

TS = pd.to_datetime([f"2026-06-22 00:0{i}:00" for i in range(6)])


def frame(values: list[float], statuses: list[int] | None = None) -> pd.DataFrame:
    return pd.DataFrame(
        {
            "timestamp": TS,
            "TI-101": values,
            "TI-101__status": pd.array(
                statuses or [STATUS_GOOD] * len(values), dtype="int8"
            ),
        }
    )


def two_tag_frame() -> pd.DataFrame:
    df = frame([10.0, 11.0, 12.0, 13.0, 14.0, 15.0])
    df["FI-404"] = [1.0, 2.0, 3.0, 4.0, 5.0, 6.0]
    df["FI-404__status"] = pd.array([STATUS_GOOD] * 6, dtype="int8")
    return df


# ── coverage / null_pct ─────────────────────────────────────────────────


def test_coverage_and_null_pct_are_complements_over_good_cells():
    df = frame(
        [10.0, 0.0, 12.0, 13.0, 14.0, 15.0],
        statuses=[STATUS_GOOD, STATUS_BAD, STATUS_GOOD, STATUS_GOOD, STATUS_GOOD, STATUS_GOOD],
    )
    stats = build_column_stats(df, [])

    assert stats["TI-101"]["null_pct"] == pytest.approx(100 / 6, abs=0.01)
    assert stats["TI-101"]["coverage"] == pytest.approx(500 / 6, abs=0.01)


def test_all_good_column_has_zero_null_pct():
    stats = build_column_stats(frame([1.0, 2.0, 3.0, 4.0, 5.0, 6.0]), [])
    assert stats["TI-101"]["null_pct"] == 0.0
    assert stats["TI-101"]["coverage"] == 100.0


# ── min / max / mean ────────────────────────────────────────────────────


def test_min_max_mean_are_over_good_cells_only():
    df = frame(
        [10.0, 0.0, 20.0, 30.0, 40.0, 50.0],
        statuses=[STATUS_GOOD, STATUS_BAD, STATUS_GOOD, STATUS_GOOD, STATUS_GOOD, STATUS_GOOD],
    )
    stats = build_column_stats(df, [])["TI-101"]

    # The 0.0 hole must not win min() or drag mean() toward zero.
    assert stats["min"] == 10.0
    assert stats["max"] == 50.0
    assert stats["mean"] == pytest.approx((10 + 20 + 30 + 40 + 50) / 5)


def test_all_bad_column_reports_null_stats_not_zero():
    df = frame([0.0] * 6, statuses=[STATUS_BAD] * 6)
    stats = build_column_stats(df, [])["TI-101"]
    assert stats["min"] is None
    assert stats["max"] is None
    assert stats["mean"] is None
    assert stats["coverage"] == 0.0


# ── outlier_count ────────────────────────────────────────────────────────


def test_outlier_count_flags_a_point_outside_the_iqr_fence():
    df = frame([10.0, 11.0, 12.0, 13.0, 14.0, 500.0])
    stats = build_column_stats(df, [])["TI-101"]
    assert stats["outlier_count"] == 1


def test_outlier_count_ignores_bad_cells():
    """A Bad cell's 0.0 hole must not be COUNTED as an outlier itself, and
    must not be part of the fence computation that decides what IS one."""
    df = frame(
        [10.0, 11.0, 12.0, 13.0, 14.0, 0.0],
        statuses=[STATUS_GOOD] * 5 + [STATUS_BAD],
    )
    stats = build_column_stats(df, [])["TI-101"]
    assert stats["outlier_count"] == 0


def test_outlier_count_is_zero_with_fewer_than_four_good_points():
    df = frame([10.0, 500.0, 0.0, 0.0, 0.0, 0.0], statuses=[STATUS_GOOD, STATUS_GOOD] + [STATUS_BAD] * 4)
    stats = build_column_stats(df, [])["TI-101"]
    assert stats["outlier_count"] == 0


# ── cleaned flag ─────────────────────────────────────────────────────────


def test_cleaned_is_true_when_an_operation_names_the_tag():
    stats = build_column_stats(
        two_tag_frame(),
        [CleaningOperation(type="drop_missing", tags=["TI-101"])],
    )
    assert stats["TI-101"]["cleaned"] is True
    assert stats["FI-404"]["cleaned"] is False


def test_cleaned_is_true_for_every_tag_when_operation_tags_is_omitted():
    stats = build_column_stats(
        two_tag_frame(),
        [CleaningOperation(type="drop_missing")],
    )
    assert stats["TI-101"]["cleaned"] is True
    assert stats["FI-404"]["cleaned"] is True


def test_cleaned_is_true_for_every_tag_with_explicit_wildcard():
    stats = build_column_stats(
        two_tag_frame(),
        [CleaningOperation(type="drop_missing", tags=["*"])],
    )
    assert stats["FI-404"]["cleaned"] is True


def test_cleaned_is_false_with_no_operations():
    stats = build_column_stats(two_tag_frame(), [])
    assert stats["TI-101"]["cleaned"] is False
    assert stats["FI-404"]["cleaned"] is False


# ── drift ────────────────────────────────────────────────────────────────


def test_drift_is_none_with_no_parent_frame():
    """A BRONZE root (test_materialized_artifact_has_no_parent) has nothing
    to drift from — None, not 0, so it cannot be mistaken for 'no drift'."""
    stats = build_column_stats(frame([1.0, 2.0, 3.0, 4.0, 5.0, 6.0]), [])
    assert stats["TI-101"]["drift"] is None


def test_drift_is_the_signed_mean_delta_against_the_parent():
    parent = frame([10.0, 10.0, 10.0, 10.0, 10.0, 10.0])
    child = frame([20.0, 20.0, 20.0, 20.0, 20.0, 20.0])
    stats = build_column_stats(child, [], parent_frame=parent)["TI-101"]
    assert stats["drift"] == pytest.approx(10.0)


def test_drift_is_none_when_the_tag_is_new_and_has_no_parent_column():
    parent = frame([10.0] * 6)  # only TI-101
    child = two_tag_frame()  # TI-101 + FI-404
    stats = build_column_stats(child, [], parent_frame=parent)
    assert stats["FI-404"]["drift"] is None
    assert stats["TI-101"]["drift"] is not None


def test_drift_is_none_when_the_parent_column_is_entirely_bad():
    parent = frame([0.0] * 6, statuses=[STATUS_BAD] * 6)
    child = frame([10.0] * 6)
    stats = build_column_stats(child, [], parent_frame=parent)["TI-101"]
    assert stats["drift"] is None


# ── shape ────────────────────────────────────────────────────────────────


def test_every_logical_tag_gets_one_entry_keyed_by_name():
    stats = build_column_stats(two_tag_frame(), [])
    assert set(stats.keys()) == {"TI-101", "FI-404"}
    assert stats["TI-101"]["tag"] == "TI-101"


# ── percentiles (DS-LAKE-005B-B-T01, edit 3) ────────────────────────────


def test_percentile_bounds_matches_the_clients_own_positional_interpolation():
    # Hand-verified against apps/client/lib/precleanse.ts::percentileBounds'
    # exact algorithm: idx = (n-1)*p/100, interpolate sorted[floor]..sorted[ceil].
    # 10 points 1..10 (already sorted). p50 -> idx=4.5 -> interpolate 5,6 -> 5.5.
    good = np.array([float(i) for i in range(1, 11)])
    result = percentile_bounds(good, points=(50,))
    assert result == {"p50": 5.5}


def test_percentile_bounds_covers_every_clip_preset_point():
    good = np.array([float(i) for i in range(1, 101)])  # 1..100
    result = percentile_bounds(good)
    assert set(result.keys()) == {
        "p1",
        "p5",
        "p10",
        "p20",
        "p80",
        "p90",
        "p95",
        "p99",
    }
    # 1..100, p1 -> idx=0.99 -> interpolate 1,2 -> ~1.99; p99 mirrors it.
    assert result["p1"] == pytest.approx(1.99, abs=0.01)
    assert result["p99"] == pytest.approx(99.01, abs=0.01)


def test_percentile_bounds_is_none_with_no_good_values():
    assert percentile_bounds(np.array([])) is None


def test_percentile_bounds_ignores_bad_cells_through_build_column_stats():
    # Same Good-only convention as every other stat here — a Bad cell's 0.0
    # hole must not pull a percentile toward zero.
    stats = build_column_stats(
        frame(
            [100.0, 0.0, 100.0, 0.0, 100.0, 100.0],
            statuses=[
                STATUS_GOOD,
                STATUS_BAD,
                STATUS_GOOD,
                STATUS_BAD,
                STATUS_GOOD,
                STATUS_GOOD,
            ],
        ),
        [],
    )["TI-101"]
    # Every Good value is 100.0 — every percentile must be 100.0, not pulled
    # toward the Bad cells' 0.0 hole.
    assert all(v == 100.0 for v in stats["percentiles"].values())


def test_column_stats_percentiles_is_none_for_an_all_bad_tag():
    stats = build_column_stats(
        frame([0.0] * 6, statuses=[STATUS_BAD] * 6), []
    )["TI-101"]
    assert stats["percentiles"] is None
