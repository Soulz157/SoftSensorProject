"""DS-LAKE-007-T01: validation_service checks.

Each test proves the FAIL branch actually names the offender and the
measured magnitude (AC: "names which check failed and by how much"), not
just that `passed` flips to `False`.
"""

from __future__ import annotations

import pandas as pd
import pytest

from intergrations.object_store import STATUS_BAD, STATUS_GOOD
from services import validation_service as vs

TS = pd.to_datetime([f"2026-06-22 00:0{i}:00" for i in range(6)])


def frame(
    values: dict[str, list[float]], statuses: dict[str, list[int]] | None = None
) -> pd.DataFrame:
    statuses = statuses or {}
    data: dict[str, object] = {"timestamp": TS}
    for tag, vals in values.items():
        data[tag] = vals
        st = statuses.get(tag, [STATUS_GOOD] * len(vals))
        data[f"{tag}__status"] = pd.array(st, dtype="int8")
    return pd.DataFrame(data)


# ── schema ───────────────────────────────────────────────────────────────


def test_schema_passes_a_well_formed_frame() -> None:
    df = frame({"TI-101": [1, 2, 3, 4, 5, 6]})
    result = vs.check_schema(df)
    assert result.passed


def test_schema_fails_a_missing_timestamp_column() -> None:
    df = frame({"TI-101": [1, 2, 3, 4, 5, 6]}).drop(columns=["timestamp"])
    result = vs.check_schema(df)
    assert not result.passed
    assert "timestamp" in result.detail


# ── duplicate timestamps ────────────────────────────────────────────────


def test_duplicate_timestamps_fails_and_counts_them() -> None:
    df = frame({"TI-101": [1, 2, 3, 4, 5, 6]})
    df.loc[1, "timestamp"] = df.loc[0, "timestamp"]  # one duplicate
    result = vs.check_duplicate_timestamps(df)
    assert not result.passed
    assert result.measured == 1.0


def test_duplicate_timestamps_passes_a_unique_series() -> None:
    df = frame({"TI-101": [1, 2, 3, 4, 5, 6]})
    result = vs.check_duplicate_timestamps(df)
    assert result.passed


# ── missing values ───────────────────────────────────────────────────────


def test_missing_values_fails_and_names_the_worst_tag() -> None:
    # 4 of 6 Bad -> 66.7% missing, well over the 20% default threshold.
    df = frame(
        {"TI-101": [1, 2, 3, 4, 5, 6], "VI-202": [1, 2, 3, 4, 5, 6]},
        {"TI-101": [STATUS_BAD] * 4 + [STATUS_GOOD] * 2},
    )
    result = vs.check_missing_values(df)
    assert not result.passed
    assert "TI-101" in result.offenders
    assert "VI-202" not in result.offenders
    assert result.measured == pytest.approx(66.6667, abs=0.01)


def test_missing_values_passes_within_threshold() -> None:
    df = frame({"TI-101": [1, 2, 3, 4, 5, 6]})
    result = vs.check_missing_values(df)
    assert result.passed


# ── feature consistency ─────────────────────────────────────────────────


def test_feature_consistency_skips_without_a_spec() -> None:
    df = frame({"TI-101": [1, 2, 3, 4, 5, 6]})
    result = vs.check_feature_consistency(df, None)
    assert result.passed
    assert result.skipped


def test_feature_consistency_fails_a_missing_named_feature() -> None:
    df = frame({"TI-101": [1, 2, 3, 4, 5, 6]})
    spec = {"features": [{"name": "TI-101__lag1", "kind": "lag"}]}
    result = vs.check_feature_consistency(df, spec)
    assert not result.passed
    assert result.offenders == ["TI-101__lag1"]


def test_feature_consistency_passes_when_every_named_feature_exists() -> None:
    df = frame({"TI-101": [1, 2, 3, 4, 5, 6], "TI-101__lag1": [0, 1, 2, 3, 4, 5]})
    spec = {"features": [{"name": "TI-101__lag1", "kind": "lag"}]}
    result = vs.check_feature_consistency(df, spec)
    assert result.passed


# ── statistical ──────────────────────────────────────────────────────────


def test_statistical_flags_a_degenerate_zero_variance_tag() -> None:
    df = frame({"TI-101": [72.0] * 6})  # every reading identical
    result = vs.check_statistical(df)
    assert not result.passed
    assert "TI-101" in result.offenders


def test_statistical_flags_a_high_outlier_fraction() -> None:
    df = frame({"TI-101": [72.0, 71.0, 73.0, 72.5, 5000.0, 71.5]})
    result = vs.check_statistical(df, max_outlier_fraction=0.01)
    assert not result.passed
    assert "TI-101" in result.offenders


def test_statistical_passes_a_healthy_tag() -> None:
    df = frame({"TI-101": [72.0, 71.5, 72.5, 71.8, 72.2, 71.9]})
    result = vs.check_statistical(df)
    assert result.passed


# ── completeness ─────────────────────────────────────────────────────────


def test_completeness_skips_without_an_expected_list() -> None:
    df = frame({"TI-101": [1, 2, 3, 4, 5, 6]})
    result = vs.check_completeness(df, None)
    assert result.passed
    assert result.skipped


def test_completeness_fails_a_missing_expected_tag() -> None:
    df = frame({"TI-101": [1, 2, 3, 4, 5, 6]})
    result = vs.check_completeness(df, ["TI-101", "VI-202"])
    assert not result.passed
    assert result.offenders == ["VI-202"]


# ── run_validation (the whole report) ───────────────────────────────────


def test_run_validation_passes_a_clean_artifact() -> None:
    df = frame({"TI-101": [72.0, 71.5, 72.5, 71.8, 72.2, 71.9]})
    report = vs.run_validation(df)
    assert report["status"] == "PASS"
    assert report["failed_checks"] == []
    assert len(report["checks"]) == 6
    assert report["quality_score"] == 100.0


def test_run_validation_fails_when_any_single_check_fails() -> None:
    df = frame({"TI-101": [72.0] * 6})  # degenerate -> statistical fails
    report = vs.run_validation(df)
    assert report["status"] == "FAIL"
    assert "statistical" in report["failed_checks"]
    # Every OTHER check still ran and reported its own honest result — not
    # a truncated report just because one check failed.
    assert len(report["checks"]) == 6
    names = {c["name"] for c in report["checks"]}
    assert names == {
        "schema",
        "duplicate_timestamps",
        "missing_values",
        "feature_consistency",
        "statistical",
        "completeness",
    }


def test_run_validation_never_mutates_the_input_frame() -> None:
    df = frame({"TI-101": [1, 2, 3, 4, 5, 6]})
    before = df.copy()
    vs.run_validation(df, feature_spec={"features": []}, expected_tags=["TI-101"])
    pd.testing.assert_frame_equal(df, before)


# ── compute_quality_score (DS-LAKE-007-T03) ─────────────────────────────


def _passed(name: str) -> vs.CheckResult:
    return vs.CheckResult(name, True, "ok")


def _failed(name: str) -> vs.CheckResult:
    return vs.CheckResult(name, False, "bad")


def _skipped(name: str) -> vs.CheckResult:
    # This module's own convention: a skip is passed=True, skipped=True.
    return vs.CheckResult(name, True, "n/a", skipped=True)


def test_quality_score_is_100_when_every_check_passes() -> None:
    checks = [_passed(name) for name in vs.CHECK_WEIGHTS]
    assert vs.compute_quality_score(checks) == 100.0


def test_quality_score_is_0_when_every_check_fails() -> None:
    checks = [_failed(name) for name in vs.CHECK_WEIGHTS]
    assert vs.compute_quality_score(checks) == 0.0


def test_quality_score_subtracts_exactly_the_failed_checks_own_weight() -> None:
    checks = [
        _passed("schema"),
        _failed("missing_values"),  # weight 20
        _passed("duplicate_timestamps"),
        _passed("feature_consistency"),
        _failed("statistical"),  # weight 10
        _passed("completeness"),
    ]
    assert vs.compute_quality_score(checks) == 70.0


def test_quality_score_treats_a_skipped_check_as_free_same_as_a_pass() -> None:
    all_passed = [_passed(name) for name in vs.CHECK_WEIGHTS]
    with_skips = [
        _skipped(name) if name in ("feature_consistency", "completeness") else _passed(name)
        for name in vs.CHECK_WEIGHTS
    ]
    assert vs.compute_quality_score(with_skips) == vs.compute_quality_score(all_passed) == 100.0


def test_quality_score_never_goes_negative() -> None:
    # Sanity floor, even though CHECK_WEIGHTS already sums to exactly 100 —
    # an unrecognised check name (weight 0 via .get default) plus every
    # named one failing must still floor at 0, not dip below it.
    checks = [_failed(name) for name in vs.CHECK_WEIGHTS] + [_failed("unknown_check")]
    assert vs.compute_quality_score(checks) == 0.0


def test_quality_score_is_deterministic_for_the_same_report() -> None:
    df = frame({"TI-101": [72.0] * 6})  # degenerate -> one known failure
    first = vs.run_validation(df)["quality_score"]
    second = vs.run_validation(df)["quality_score"]
    third = vs.run_validation(df)["quality_score"]
    assert first == second == third == 90.0  # 100 - statistical's weight (10)
