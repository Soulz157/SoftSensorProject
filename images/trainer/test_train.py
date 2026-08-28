"""DS-LAKE-023-T03/D4: `train.py`'s `labelled_mask` — the non-Good-target
mask shared between the train/test split (steps 6-7) and holdout scoring.

No existing test infrastructure covers this file (it is a standalone Docker
training-container entrypoint, never imported outside its own container) —
this is new coverage for the ONE pure function this fix introduces/extracts,
not an attempt to test the whole training flow (which needs a live PI
container, S3 credentials, and a real training run to exercise end to end).

`train.py` reads RUN_ID/RUN_TOKEN/API_BASE from the environment at module
scope, so those are set to synthetic placeholders before import.
"""

import os
import sys
from pathlib import Path

os.environ.setdefault("RUN_ID", "test-run")
os.environ.setdefault("RUN_TOKEN", "test-token")
os.environ.setdefault("API_BASE", "http://localhost:0")

sys.path.insert(0, str(Path(__file__).parent))

import pandas as pd  # noqa: E402

from train import (  # noqa: E402
    MAX_LOSS_HISTORY_POINTS,
    STATUS_GOOD,
    extract_loss_history,
    labelled_mask,
    status_column,
)


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


if __name__ == "__main__":
    import pytest

    raise SystemExit(pytest.main([__file__, "-v"]))
