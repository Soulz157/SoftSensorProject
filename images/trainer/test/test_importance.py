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

from importance import extract_feature_importance

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
