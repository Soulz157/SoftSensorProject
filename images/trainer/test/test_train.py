"""DS-LAKE-023-T03/D4: `labelled_mask` — the non-Good-target mask shared
between the train/test split (steps 6-7) and holdout scoring — plus the other
pure functions this image can exercise without a live run.

No existing test infrastructure covers this image (it is a standalone Docker
training container, never imported outside itself) — this is coverage for the
pure functions only, not an attempt to test the whole training flow (which
needs a live PI container, S3 credentials, and a real training run to exercise
end to end).

Imports are per-module and no longer routed through `train.py`: the module
split moved every function below out of the entrypoint, which now holds only
the mode dispatch. The names and behaviour are unchanged — only where they
live is.

The environment placeholders the single-file version needed are gone with it.
RUN_ID/RUN_TOKEN/API_BASE are read by `RunContext.from_env()`, called
explicitly by the entrypoint, so importing any function here no longer touches
the environment at all (see config.py's module docstring for why that was the
point of moving it). `sys.path` is set up by the image-root `conftest.py`,
which puts `app/` on it exactly as the container's own `sys.path[0]` does — so
these are the same import names the running image resolves.
"""

import numpy as np
import pandas as pd
import pytest

from config import STATUS_GOOD
from guards import assert_no_nan_features, assert_no_window_leakage
from labels import labelled_mask, status_column
from metrics import MAX_LOSS_HISTORY_POINTS, extract_loss_history
from splits import chronological_split_windows, expanding_fold_plan
from windows import build_windows


def _frame(target_values: list[float | None], statuses: list[int] | None = None) -> pd.DataFrame:
    data: dict[str, object] = {
        "timestamp": pd.date_range("2026-01-01", periods=len(target_values), freq="D"),
        "TI-101": target_values,
    }
    if statuses is not None:
        data[status_column("TI-101")] = statuses
    return pd.DataFrame(data)


def test_labelled_mask_uses_status_good_when_sidecar_present():
    # Good/Bad/Good, with the middle row's Bad status overriding its
    # non-null value — proves this reads the SIDECAR, not just notna().
    frame = _frame([1.0, 2.0, 3.0], statuses=[STATUS_GOOD, 99, STATUS_GOOD])
    mask = labelled_mask(frame, "TI-101")
    assert mask.tolist() == [True, False, True]


def test_labelled_mask_falls_back_to_notna_when_no_status_sidecar():
    frame = _frame([1.0, None, 3.0])
    warnings = []
    mask = labelled_mask(
        frame, "TI-101", log_fn=lambda msg, level="info": warnings.append((msg, level))
    )
    assert mask.tolist() == [True, False, True]
    assert warnings and warnings[0][1] == "warn"


def test_labelled_mask_combines_status_and_notna():
    # Good status but a null value (a real gap in the sidecar's own
    # bookkeeping) must still be excluded — `& frame[target_y].notna()`.
    frame = _frame([1.0, None, 3.0], statuses=[STATUS_GOOD, STATUS_GOOD, STATUS_GOOD])
    mask = labelled_mask(frame, "TI-101")
    assert mask.tolist() == [True, False, True]


def test_labelled_mask_all_good_keeps_every_row():
    frame = _frame([1.0, 2.0, 3.0], statuses=[STATUS_GOOD, STATUS_GOOD, STATUS_GOOD])
    mask = labelled_mask(frame, "TI-101")
    assert mask.tolist() == [True, True, True]


class _FakeModel:
    """Stand-in for a fitted estimator — only the post-fit attributes/methods
    `extract_loss_history` reads, no real sklearn/lightgbm/xgboost fit
    needed (MODEL-FLOW-013-T05, same no-live-estimator precedent this file
    already sets for `labelled_mask` above)."""

    def __init__(self, **attrs):
        for key, value in attrs.items():
            setattr(self, key, value)

    def evals_result(self):
        return self._evals_result


def test_extract_loss_history_mlp_is_train_only_with_loss_metric():
    model = _FakeModel(loss_curve_=[0.9, 0.5, 0.3])
    history = extract_loss_history("mlp", model)
    assert history == {
        "algorithm": "mlp",
        "metric": "loss",
        "series": {"train": [0.9, 0.5, 0.3]},
    }


def test_extract_loss_history_hgb_returns_none_when_early_stopping_did_not_run():
    # LIVE-VERIFIED regression guard (scikit-learn 1.5.2, the pinned
    # version): train_score_/validation_score_ ALWAYS exist as attributes
    # on a fitted HistGradientBoostingRegressor, but are EMPTY arrays — not
    # absent — whenever early_stopping resolved to False, which is the
    # unconfigured default ('auto') for any dataset at or under 10,000 rows,
    # the common case in this trainer's domain. A version that checked
    # hasattr()/is None instead of len()==0 would have produced a
    # technically-present but empty series here — misleading, not honest.
    model = _FakeModel(train_score_=[], validation_score_=[])
    assert extract_loss_history("hist_gradient_boosting", model) is None


def test_extract_loss_history_hgb_includes_validation_only_when_populated():
    without_validation = _FakeModel(train_score_=[0.9, 0.6])
    history = extract_loss_history("hist_gradient_boosting", without_validation)
    assert history is not None
    assert "validation" not in history["series"]

    with_validation = _FakeModel(train_score_=[0.9, 0.6], validation_score_=[0.95, 0.7])
    history = extract_loss_history("hist_gradient_boosting", with_validation)
    assert history["series"]["validation"] == [0.95, 0.7]


def test_extract_loss_history_lightgbm_reads_evals_result_rmse():
    model = _FakeModel(
        evals_result_={"train": {"rmse": [1.0, 0.5]}, "validation": {"rmse": [1.1, 0.6]}}
    )
    history = extract_loss_history("lightgbm", model)
    assert history == {
        "algorithm": "lightgbm",
        "metric": "rmse",
        "series": {"train": [1.0, 0.5], "validation": [1.1, 0.6]},
    }


def test_extract_loss_history_xgboost_maps_validation_0_1_to_train_validation():
    model = _FakeModel()
    model._evals_result = {
        "validation_0": {"rmse": [1.0, 0.4]},
        "validation_1": {"rmse": [1.2, 0.5]},
    }
    history = extract_loss_history("xgboost", model)
    assert history["series"] == {"train": [1.0, 0.4], "validation": [1.2, 0.5]}


def test_extract_loss_history_closed_form_algorithm_writes_nothing():
    # No artifact and no placeholder — a curve cannot be produced for a
    # closed-form fit, not "has not been produced yet."
    for algorithm in ("ols", "ridge", "pls", "grp", "svm", "random_forest"):
        assert extract_loss_history(algorithm, _FakeModel()) is None


def test_extract_loss_history_bounds_by_name_not_by_truncation():
    too_long = [0.5] * (MAX_LOSS_HISTORY_POINTS + 1)
    model = _FakeModel(loss_curve_=too_long)
    assert extract_loss_history("mlp", model) is None


def test_extract_loss_history_swallows_a_missing_attribute_rather_than_raising():
    # An estimator that raises mid-extraction (e.g. an unexpected API
    # shape) must not fail an otherwise-successful training run.
    assert extract_loss_history("lightgbm", _FakeModel()) is None


def _grid_frame(n: int, labelled_rows: set[int], feature_col: str = "F1") -> tuple[pd.DataFrame, pd.Series]:
    """MODEL-FLOW-009-T01. `n` rows on a regular 1-minute grid; `feature_col`
    holds each row's own position (0..n-1) so a window's exact contents can
    be asserted by original row index. `labelled_rows` marks which
    positions have a Good target — the rest are Bad, simulating a target
    sampled far sparser than the feature grid (the exact shape
    `build_windows`'s full-frame-not-labelled-only design exists for)."""
    frame = pd.DataFrame(
        {
            "timestamp": pd.date_range("2026-01-01", periods=n, freq="min"),
            feature_col: [float(i) for i in range(n)],
            "TI-101": [float(i) for i in range(n)],
            status_column("TI-101"): [
                STATUS_GOOD if i in labelled_rows else 99 for i in range(n)
            ],
        }
    )
    mask = labelled_mask(frame, "TI-101")
    return frame, mask


def test_build_windows_spans_true_grid_spacing_not_labelled_only_spacing():
    # Rows 0-4 and 10-14 are labelled; rows 5-9 are not (a gap, same shape
    # as a lab target sampled far sparser than the feature grid). A window
    # over the FULL frame at target row 10, length 3, must be original
    # rows [8, 9, 10] — three CONSECUTIVE MINUTES. Windowing over the
    # `labelled`-only reduced frame instead would (wrongly) pull reduced
    # rows [3, 4, 5] = original rows [3, 4, 10], splicing rows from six
    # minutes earlier into what would look like a 3-minute window.
    frame, mask = _grid_frame(20, labelled_rows=set(range(0, 5)) | set(range(10, 15)))
    X, y, target_ts = build_windows(
        frame, "TI-101", ["F1"], sequence_length=3, label_mask=mask)

    target_row_10 = list(target_ts).index(frame.loc[10, "timestamp"])
    assert X[target_row_10, :, 0].tolist() == [8.0, 9.0, 10.0]
    assert y[target_row_10] == 10.0


def test_build_windows_drops_targets_without_enough_history():
    # Labelled rows 0 and 1 sit before enough history exists for
    # sequence_length=3 (a window needs 3 rows ending at the target) — no
    # padding, no partial window: they simply produce no window, same as
    # an unlabelled row.
    frame, mask = _grid_frame(5, labelled_rows={0, 1, 4})
    X, y, target_ts = build_windows(
        frame, "TI-101", ["F1"], sequence_length=3, label_mask=mask)
    assert len(y) == 1
    assert y[0] == 4.0
    assert X[0, :, 0].tolist() == [2.0, 3.0, 4.0]


def test_build_windows_excludes_unlabelled_target_rows_even_with_full_history():
    frame, mask = _grid_frame(10, labelled_rows={5})
    X, y, target_ts = build_windows(
        frame, "TI-101", ["F1"], sequence_length=4, label_mask=mask)
    assert len(y) == 1
    assert y[0] == 5.0


def test_build_windows_requires_sorted_frame():
    frame, mask = _grid_frame(5, labelled_rows={4})
    shuffled = frame.iloc[::-1].reset_index(drop=True)
    shuffled_mask = mask.iloc[::-1].reset_index(drop=True)
    with pytest.raises(RuntimeError, match="sorted"):
        build_windows(shuffled, "TI-101", ["F1"],
                       sequence_length=3, label_mask=shuffled_mask)


def test_build_windows_returns_empty_arrays_when_nothing_qualifies():
    frame, mask = _grid_frame(5, labelled_rows=set())
    X, y, target_ts = build_windows(
        frame, "TI-101", ["F1"], sequence_length=3, label_mask=mask)
    assert X.shape == (0, 3, 1)
    assert len(y) == 0
    assert len(target_ts) == 0


def test_chronological_split_windows_matches_flat_split_cut_rule():
    # Windows are already target-timestamp ordered (build_windows walks
    # the frame ascending) — same ratio*n cut rule chronological_split
    # applies to a flat frame, applied here to window count instead of
    # row count.
    timestamps = pd.Series(pd.date_range("2026-01-01", periods=10, freq="D"))
    train_idx, test_idx, cut_ts = chronological_split_windows(
        timestamps, ratio=0.7)
    assert list(train_idx) == list(range(7))
    assert list(test_idx) == list(range(7, 10))
    assert cut_ts == str(timestamps.iloc[7])


def test_chronological_split_windows_rejects_empty_or_unsorted():
    with pytest.raises(RuntimeError):
        chronological_split_windows(
            pd.Series([], dtype="datetime64[ns]"), ratio=0.7)
    unsorted = pd.Series(pd.date_range(
        "2026-01-01", periods=5, freq="D"))[::-1].reset_index(drop=True)
    with pytest.raises(RuntimeError):
        chronological_split_windows(unsorted, ratio=0.5)


def test_assert_no_window_leakage_passes_for_correctly_target_keyed_windows():
    timestamps = pd.Series(pd.date_range("2026-01-01", periods=10, freq="D"))
    train_idx, _, cut_ts = chronological_split_windows(timestamps, ratio=0.7)
    assert_no_window_leakage(timestamps, train_idx, cut_ts)  # must not raise


def test_assert_no_window_leakage_catches_start_indexed_assignment_bug():
    # The real failure mode T02 guards against: assigning windows to
    # train/test by their START position instead of their TARGET
    # timestamp. Simulate it directly — a "train" set that includes a
    # window whose target sits at/after the cut.
    timestamps = pd.Series(pd.date_range("2026-01-01", periods=10, freq="D"))
    _, _, cut_ts = chronological_split_windows(timestamps, ratio=0.7)
    buggy_train_idx = np.arange(0, 8)  # includes index 7, target >= cut
    with pytest.raises(RuntimeError, match="start index"):
        assert_no_window_leakage(timestamps, buggy_train_idx, cut_ts)


def test_assert_no_nan_features_passes_on_clean_windows():
    X = np.zeros((3, 4, 2))
    assert_no_nan_features(X, "training")  # must not raise


def test_assert_no_nan_features_catches_nan_on_a_non_target_row():
    # A window's INCLUSION is gated on its TARGET row's label
    # (build_windows), never on its non-target rows' quality — a NaN
    # feature on one of those in-window rows (row 0 here, not the target
    # row at index -1) must still be caught, not silently trained on.
    X = np.zeros((2, 3, 2))
    X[1, 0, 1] = np.nan
    with pytest.raises(RuntimeError, match="NaN feature"):
        assert_no_nan_features(X, "training")


def test_assert_no_nan_features_empty_array_does_not_raise():
    X = np.empty((0, 3, 2))
    assert_no_nan_features(X, "training")  # must not raise


# ── MODEL-FLOW-016-T03: expanding_fold_plan ─────────────────────────────
#
# This mirrors _expanding_fold_plan in apps/python's split_stats_service.py
# — no cross-import is possible (separate container images), so the
# guarantee both copies agree is: (a) both were independently checked
# index-for-index against a REAL sklearn.model_selection.TimeSeriesSplit
# (see split_stats_service.py's own MIN_LABELS_PER_FOLD comment for the
# n/k values checked), and (b) both are pinned here against the SAME
# formula, the same way test_split_stats_service.py pins its own copy.
# The exact-value cross-system pin (this function's output against a real
# /split-stats response for the same real artifact) happens once the
# trainer image is built and a live run executes — see this feature's own
# V01.


def _cv_frame(n_rows: int, label_every: int) -> pd.DataFrame:
    """A 1-minute grid, `n_rows` long, with `TI-101` Good only every
    `label_every` rows — the sparse-target shape needed to prove a
    labelled-frame cut differs from a naive row-count cut (V01's own claim,
    restated for CV). STATUS_GOOD is 0 in this file, so the "bad" fallback
    below must be a distinct nonzero value — not another 0, which would
    silently mark every row Good and defeat the sparse-target fixture."""
    ts = pd.date_range("2026-01-01", periods=n_rows, freq="min")
    statuses = [
        STATUS_GOOD if i % label_every == 0 else STATUS_GOOD + 1
        for i in range(n_rows)
    ]
    return pd.DataFrame(
        {
            "timestamp": ts,
            "TI-101": list(range(n_rows)),
            status_column("TI-101"): pd.array(statuses, dtype="int8"),
        }
    )


def test_expanding_fold_plan_is_expanding_and_strictly_chronological():
    frame = _cv_frame(n_rows=12_000, label_every=37)
    labelled = frame.loc[
        frame[status_column("TI-101")] == STATUS_GOOD
    ].sort_values("timestamp").reset_index(drop=True)

    folds = expanding_fold_plan(labelled, "TI-101", k=5)

    assert len(folds) == 5
    train_rows = [f["train_rows"] for f in folds]
    assert train_rows == sorted(train_rows)
    assert len(set(train_rows)) == len(train_rows)  # strictly increasing
    cuts = [f["cut_timestamp"] for f in folds]
    assert cuts == sorted(cuts)
    assert len(set(cuts)) == len(cuts)
    # No gap, no overlap: fold 0's train plus every fold's test accounts
    # for the entire labelled frame.
    assert train_rows[0] + sum(f["test_rows"] for f in folds) == len(labelled)


def test_expanding_fold_plan_cuts_on_labelled_rows_not_row_count():
    # V01, restated for CV: label_every=37 does not divide evenly into any
    # fold boundary, so the correct (labelled-frame) cut and a naive
    # (row-count) cut land on different rows — a dense target would pass
    # either rule and prove nothing.
    frame = _cv_frame(n_rows=12_000, label_every=37)
    labelled = frame.loc[
        frame[status_column("TI-101")] == STATUS_GOOD
    ].sort_values("timestamp").reset_index(drop=True)
    k = 5
    n_labelled = len(labelled)
    test_size = n_labelled // (k + 1)

    folds = expanding_fold_plan(labelled, "TI-101", k)

    for i, fold in enumerate(folds):
        correct_test_start = n_labelled - (k - i) * test_size
        correct_cut = str(labelled.loc[correct_test_start, "timestamp"])
        assert fold["cut_timestamp"] == correct_cut

        naive_test_start = len(frame) - (k - i) * (len(frame) // (k + 1))
        if 0 <= naive_test_start < len(frame):
            naive_cut = str(frame.loc[naive_test_start, "timestamp"])
            assert fold["cut_timestamp"] != naive_cut


def test_expanding_fold_plan_remainder_lands_in_fold_zero_train():
    # A remainder that does not divide evenly into (k+1) must land in fold
    # 0's train window, never in any fold's test window — the SAME
    # accounting real TimeSeriesSplit uses (verified live against it; see
    # split_stats_service.py's own comment).
    n = 103  # 103 // 6 = 17, remainder 1 -> fold 0's train absorbs it
    frame = pd.DataFrame(
        {
            "timestamp": pd.date_range("2026-01-01", periods=n, freq="min"),
            "TI-101": list(range(n)),
        }
    )
    folds = expanding_fold_plan(frame, "TI-101", k=5)
    test_size = n // 6
    assert all(f["test_rows"] == test_size for f in folds)
    assert folds[0]["train_rows"] == n - 5 * test_size  # absorbs the remainder


if __name__ == "__main__":
    raise SystemExit(pytest.main([__file__, "-v"]))
