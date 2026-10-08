"""MODEL-FLOW-019-T09. `importance.extract_feature_importance` against real
fitted estimators — same discipline as `test_train.py`: pure-function coverage
for this standalone image, no live run/container needed. `sys.path` is set up
by the image-root `conftest.py`.
"""

from __future__ import annotations

import math

import numpy as np
import pytest
from sklearn.ensemble import RandomForestRegressor
from sklearn.linear_model import Ridge

from importance import extract_feature_importance, extract_permutation_importance

FEATURE_COLS = ["a", "b", "c"]


def _xy(seed: int = 0):
    rng = np.random.default_rng(seed)
    X = rng.normal(size=(50, len(FEATURE_COLS)))
    y = X[:, 0] * 2.0 - X[:, 1] * 0.5 + rng.normal(scale=0.01, size=50)
    return X, y


def test_random_forest_yields_impurity_with_one_entry_per_feature():
    X, y = _xy()
    model = RandomForestRegressor(n_estimators=10, random_state=0).fit(X, y)
    result = extract_feature_importance("random_forest", model, FEATURE_COLS, {})
    assert result is not None
    assert result["algorithm"] == "random_forest"
    assert result["method"] == "impurity"
    assert result["standardized"] is None
    assert result["scaling_methods"] == []
    assert [f["name"] for f in result["features"]] == FEATURE_COLS
    # feature_importances_ is already non-negative and sums to ~1.
    assert all(f["importance"] >= 0 for f in result["features"])
    assert "coefficient" not in result["features"][0]


def test_ridge_yields_coefficient_with_signed_value_and_abs_importance():
    X, y = _xy()
    model = Ridge(alpha=1.0).fit(X, y)
    result = extract_feature_importance("ridge", model, FEATURE_COLS, {})
    assert result is not None
    assert result["method"] == "coefficient"
    for f in result["features"]:
        assert f["importance"] == pytest.approx(abs(f["coefficient"]))
        assert f["importance"] >= 0


def _minmax_params(cols=FEATURE_COLS) -> dict[str, dict[str, float]]:
    """`scalingParams` as `to_model_ready` actually records it for the default
    (minmax) scaler — the shape measured on all four scaled feature specs in
    the dev DB, 2026-09-09."""
    return {col: {"min": 0.0, "max": 1.0} for col in cols}


def test_ridge_standardized_true_when_every_feature_has_fitted_scaling_params():
    """MODEL-FLOW-019-T32, replacing a T09 test that asserted the DEFECT.

    That test passed `{"scaling": [{"tag": "a", ...}]}` — one entry for three
    features — and expected True. It read the wrong field: `scaling` carries
    only EXPLICIT scaler choices and is empty on every real spec in this
    system, while `scalingParams` carries what was actually fitted. The old
    predicate therefore answered False for a fully minmax-scaled ols run
    (90027dae, 21 of 21 features covered) exactly as for an unscaled one.
    """
    X, y = _xy()
    model = Ridge(alpha=1.0).fit(X, y)
    feature_spec = {"scaling": [], "scalingParams": _minmax_params()}
    result = extract_feature_importance("ridge", model, FEATURE_COLS, feature_spec)
    assert result is not None
    assert result["method"] == "coefficient"
    assert result["standardized"] is True
    # Recovered from the PARAM SHAPE, since `scaling` names no method at all.
    assert result["scaling_methods"] == ["minmax"]


def test_explicit_scaling_entry_names_the_method_it_declares():
    X, y = _xy()
    model = Ridge(alpha=1.0).fit(X, y)
    feature_spec = {
        "scaling": [{"tag": col, "method": "standard"} for col in FEATURE_COLS],
        "scalingParams": {col: {"mean": 0.0, "std": 1.0} for col in FEATURE_COLS},
    }
    result = extract_feature_importance("ridge", model, FEATURE_COLS, feature_spec)
    assert result is not None
    assert result["standardized"] is True
    assert result["scaling_methods"] == ["standard"]


def test_partially_scaled_frame_is_not_comparable():
    """Two features scaled and one raw is not 'scaled' — mixing units across
    features is precisely what makes a coefficient table meaningless."""
    X, y = _xy()
    model = Ridge(alpha=1.0).fit(X, y)
    feature_spec = {"scaling": [], "scalingParams": _minmax_params(["a", "b"])}
    result = extract_feature_importance("ridge", model, FEATURE_COLS, feature_spec)
    assert result is not None
    assert result["method"] == "coefficient"
    assert result["standardized"] is False


def test_unscaled_ridge_ranks_as_standardized_coefficient():
    """MODEL-FLOW-019-T32 / AC70 / V44 — the figures ARE |coef| * std(X)."""
    X, y = _xy()
    model = Ridge(alpha=1.0).fit(X, y)
    std = {"a": 2.0, "b": 0.5, "c": 4.0}
    result = extract_feature_importance(
        "ridge", model, FEATURE_COLS, {}, train_feature_std=std
    )
    assert result is not None
    assert result["method"] == "standardized-coefficient"
    assert result["standardized"] is True
    for entry in result["features"]:
        expected = abs(entry["coefficient"]) * std[entry["name"]]
        assert entry["importance"] == pytest.approx(expected)
    # The signed coefficient rides beside it UNCHANGED — only the ranked
    # magnitude is rescaled.
    assert result["features"][0]["coefficient"] == pytest.approx(model.coef_[0])


def test_an_already_scaled_run_is_untouched_by_the_new_method():
    """AC70's own limit: T32 does not change what a scaled run reports, even
    when a width is available to rescale with."""
    X, y = _xy()
    model = Ridge(alpha=1.0).fit(X, y)
    feature_spec = {"scaling": [], "scalingParams": _minmax_params()}
    result = extract_feature_importance(
        "ridge",
        model,
        FEATURE_COLS,
        feature_spec,
        train_feature_std={"a": 2.0, "b": 0.5, "c": 4.0},
    )
    assert result is not None
    assert result["method"] == "coefficient"
    for entry in result["features"]:
        assert entry["importance"] == pytest.approx(abs(entry["coefficient"]))


def test_one_missing_width_refuses_to_standardize_rather_than_filling_it_in():
    """All-or-nothing: a gap filled with 1.0 would leave that one feature
    ranked in its raw unit beside rescaled neighbours — the mis-ranking AC27
    exists to prevent, wearing the label that says it was fixed."""
    X, y = _xy()
    model = Ridge(alpha=1.0).fit(X, y)
    result = extract_feature_importance(
        "ridge", model, FEATURE_COLS, {}, train_feature_std={"a": 2.0, "b": 0.5}
    )
    assert result is not None
    assert result["method"] == "coefficient"
    assert result["standardized"] is False


def test_non_finite_width_refuses_to_standardize():
    X, y = _xy()
    model = Ridge(alpha=1.0).fit(X, y)
    result = extract_feature_importance(
        "ridge",
        model,
        FEATURE_COLS,
        {},
        train_feature_std={"a": 2.0, "b": math.nan, "c": 4.0},
    )
    assert result is not None
    assert result["standardized"] is False


def test_linear_svm_gets_the_standardized_path_too():
    class _Stub:
        kernel = "linear"
        coef_ = np.array([[0.3, -0.1, 0.2]])

    result = extract_feature_importance(
        "svm",
        _Stub(),
        FEATURE_COLS,
        {},
        train_feature_std={"a": 2.0, "b": 10.0, "c": 1.0},
    )
    assert result is not None
    assert result["method"] == "standardized-coefficient"
    # b's coefficient is the SMALLEST but its input is the widest, so
    # rescaling REORDERS them — which is the whole point of the method.
    assert result["features"][1]["importance"] == pytest.approx(1.0)
    assert result["features"][0]["importance"] == pytest.approx(0.6)


def test_pls_gets_the_predicate_fix_but_never_the_standardized_method():
    class _Stub:
        coef_ = np.array([[0.4, 0.1, -0.2]])

    scaled = extract_feature_importance(
        "pls", _Stub(), FEATURE_COLS, {"scalingParams": _minmax_params()}
    )
    assert scaled is not None
    assert scaled["standardized"] is True
    assert scaled["scaling_methods"] == ["minmax"]

    unscaled = extract_feature_importance(
        "pls",
        _Stub(),
        FEATURE_COLS,
        {},
        train_feature_std={"a": 2.0, "b": 0.5, "c": 4.0},
    )
    assert unscaled is not None
    assert unscaled["method"] == "pls-coefficient"
    assert unscaled["standardized"] is False


def test_ridge_standardized_false_when_no_scaling_recorded():
    X, y = _xy()
    model = Ridge(alpha=1.0).fit(X, y)
    result = extract_feature_importance("ridge", model, FEATURE_COLS, {})
    assert result is not None
    assert result["standardized"] is False
    assert result["scaling_methods"] == []


def test_length_mismatch_is_refused_not_truncated():
    class _Stub:
        feature_importances_ = np.array([0.5, 0.5])  # only 2, FEATURE_COLS has 3

    assert extract_feature_importance(
        "random_forest", _Stub(), FEATURE_COLS, {}
    ) is None


def test_empty_array_present_reads_as_absent_not_a_real_empty_result():
    class _Stub:
        feature_importances_ = np.array([])

    assert extract_feature_importance(
        "random_forest", _Stub(), FEATURE_COLS, {}
    ) is None


def test_non_finite_values_are_refused():
    class _Stub:
        coef_ = np.array([1.0, math.nan, 2.0])

    assert extract_feature_importance("ridge", _Stub(), FEATURE_COLS, {}) is None


def test_algorithms_with_no_importance_return_none():
    class _Stub:
        pass

    for algorithm in ("hgb", "hist_gradient_boosting", "mlp", "grp", "lstm", "gru"):
        assert extract_feature_importance(algorithm, _Stub(), FEATURE_COLS, {}) is None


def test_svm_non_linear_kernel_returns_none_even_if_coef_were_accessed():
    class _Stub:
        kernel = "rbf"

    assert extract_feature_importance("svm", _Stub(), FEATURE_COLS, {}) is None


def test_svm_linear_kernel_yields_coefficient():
    class _Stub:
        kernel = "linear"
        coef_ = np.array([[0.3, -0.1, 0.2]])  # sklearn's own 2-D shape

    result = extract_feature_importance("svm", _Stub(), FEATURE_COLS, {})
    assert result is not None
    assert result["method"] == "coefficient"
    assert result["features"][1]["coefficient"] == pytest.approx(-0.1)
    assert result["features"][1]["importance"] == pytest.approx(0.1)


def test_pls_gets_its_own_method_name_not_coefficient():
    class _Stub:
        coef_ = np.array([[0.4, 0.1, -0.2]])  # PLSRegression's own 2-D shape

    result = extract_feature_importance("pls", _Stub(), FEATURE_COLS, {})
    assert result is not None
    assert result["method"] == "pls-coefficient"
    assert result["method"] != "coefficient"


def test_estimator_that_raises_on_attribute_access_returns_none_and_never_propagates():
    class _Stub:
        @property
        def feature_importances_(self):
            raise RuntimeError("boom")

    logs = []
    result = extract_feature_importance(
        "random_forest",
        _Stub(),
        FEATURE_COLS,
        {},
        log_fn=lambda msg, level="info": logs.append((msg, level)),
    )
    assert result is None
    assert any("boom" in msg for msg, _ in logs)


# ── extract_permutation_importance — MODEL-FLOW-023-T10 ─────────────────────

PERM_FEATURE_COLS = ["channel-a", "channel-b", "channel-c"]
SEQUENCE_LENGTH = 4
N_WINDOWS = 40


class _ChannelZeroModel:
    """predict() reads ONLY channel 0's window mean — channels 1/2 are pure
    noise the model never looks at. This makes the channel-isolation claim
    exactly checkable: permuting channel 0 must move the score, permuting
    channel 1/2 must NOT move it by even a float epsilon, because predict()
    never reads those slices regardless of their values."""

    def predict(self, X):
        return X[:, :, 0].mean(axis=1)


def _perm_xy(seed: int = 0, n_windows: int = N_WINDOWS):
    rng = np.random.default_rng(seed)
    X = rng.normal(size=(n_windows, SEQUENCE_LENGTH, len(PERM_FEATURE_COLS)))
    y = X[:, :, 0].mean(axis=1)  # exactly what _ChannelZeroModel predicts
    return X, y


def test_permutes_a_whole_channel_never_a_cell_and_never_row_wise():
    """The defining claim of MODEL-FLOW-023-T10: shuffling channel 1 or 2
    (which predict() never reads) must leave the score EXACTLY unchanged —
    proving the permutation targets X[:, :, j] as a whole axis-0 shuffle,
    not a per-cell or per-row operation that could accidentally touch
    channel 0's own values."""
    X, y = _perm_xy()
    result = extract_permutation_importance(
        "lstm", _ChannelZeroModel(), PERM_FEATURE_COLS, X, y,
        seed=42, population="test_windows", n_repeats=5,
    )
    assert result is not None
    by_name = {f["name"]: f for f in result["features"]}
    # channel-a is what the model actually reads — permuting it must hurt.
    assert by_name["channel-a"]["importance_raw"] > 0
    assert by_name["channel-a"]["importance"] == by_name["channel-a"]["importance_raw"]
    # channel-b/channel-c are read by nothing in predict() — the model's
    # output is bit-for-bit identical whichever window supplies their
    # values, so the measured drop is EXACTLY zero, not merely small.
    assert by_name["channel-b"]["importance_raw"] == 0.0
    assert by_name["channel-b"]["std"] == 0.0
    assert by_name["channel-c"]["importance_raw"] == 0.0


def test_artifact_shape_matches_the_spec_verbatim():
    X, y = _perm_xy()
    result = extract_permutation_importance(
        "gru", _ChannelZeroModel(), PERM_FEATURE_COLS, X, y,
        seed=1, population="test_windows", n_repeats=3,
    )
    assert result is not None
    assert result["algorithm"] == "gru"
    assert result["method"] == "permutation"
    assert result["scored_on"] == "test_windows"
    assert result["metric"] == "rmse"
    assert result["n"] == N_WINDOWS
    assert result["n_repeats"] == 3
    assert isinstance(result["baseline_score"], float)
    assert result["baseline_score"] == pytest.approx(0.0, abs=1e-9)  # perfect fit
    for f in result["features"]:
        assert set(f.keys()) == {"name", "importance", "importance_raw", "std"}
        # The clamp invariant, structurally — never abs(), always max(0, raw).
        assert f["importance"] == max(0.0, f["importance_raw"])
        assert f["importance"] >= 0.0


def test_seed_reproducibility_same_seed_same_fitted_model_identical_vector():
    X, y = _perm_xy()
    r1 = extract_permutation_importance(
        "lstm", _ChannelZeroModel(), PERM_FEATURE_COLS, X, y,
        seed=7, population="test_windows", n_repeats=4,
    )
    r2 = extract_permutation_importance(
        "lstm", _ChannelZeroModel(), PERM_FEATURE_COLS, X, y,
        seed=7, population="test_windows", n_repeats=4,
    )
    assert r1 == r2


def test_different_seeds_are_not_required_to_agree():
    X, y = _perm_xy()
    r1 = extract_permutation_importance(
        "lstm", _ChannelZeroModel(), PERM_FEATURE_COLS, X, y,
        seed=1, population="test_windows", n_repeats=4,
    )
    r2 = extract_permutation_importance(
        "lstm", _ChannelZeroModel(), PERM_FEATURE_COLS, X, y,
        seed=2, population="test_windows", n_repeats=4,
    )
    assert r1 is not None and r2 is not None
    # channel-a's raw drop is a random-permutation MEAN, so two seeds need
    # not agree exactly — only the structural channel-b/c isolation must.
    a1 = next(f for f in r1["features"] if f["name"] == "channel-a")
    a2 = next(f for f in r2["features"] if f["name"] == "channel-a")
    assert a1["importance_raw"] > 0
    assert a2["importance_raw"] > 0


def test_too_few_windows_refuses_the_whole_run():
    X, y = _perm_xy(n_windows=5)  # below _MIN_PERMUTATION_WINDOWS
    result = extract_permutation_importance(
        "lstm", _ChannelZeroModel(), PERM_FEATURE_COLS, X, y,
        seed=0, population="test_windows",
    )
    assert result is None


def test_shape_mismatch_between_x_and_feature_cols_returns_none():
    X, y = _perm_xy()
    result = extract_permutation_importance(
        "lstm", _ChannelZeroModel(), ["only-one-col"], X, y,
        seed=0, population="test_windows",
    )
    assert result is None


def test_a_2d_x_never_a_window_tensor_returns_none_rather_than_raising():
    X_2d = np.random.default_rng(0).normal(size=(50, len(PERM_FEATURE_COLS)))
    y = X_2d[:, 0]
    result = extract_permutation_importance(
        "lstm", _ChannelZeroModel(), PERM_FEATURE_COLS, X_2d, y,
        seed=0, population="test_windows",
    )
    assert result is None


def test_predict_raising_is_best_effort_never_propagates():
    class _Explodes:
        def predict(self, X):
            raise RuntimeError("torch OOM")

    X, y = _perm_xy()
    logs = []
    result = extract_permutation_importance(
        "lstm", _Explodes(), PERM_FEATURE_COLS, X, y,
        seed=0, population="test_windows",
        log_fn=lambda msg, level="info": logs.append((msg, level)),
    )
    assert result is None
    assert any("torch OOM" in msg for msg, _ in logs)


def test_write_nothing_never_a_partial_table_on_non_finite_baseline():
    class _NanModel:
        def predict(self, X):
            return np.full(X.shape[0], np.nan)

    X, y = _perm_xy()
    result = extract_permutation_importance(
        "lstm", _NanModel(), PERM_FEATURE_COLS, X, y,
        seed=0, population="test_windows",
    )
    assert result is None
