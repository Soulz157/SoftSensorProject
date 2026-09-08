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


def test_ridge_standardized_true_when_feature_spec_records_scaling():
    X, y = _xy()
    model = Ridge(alpha=1.0).fit(X, y)
    feature_spec = {"scaling": [{"tag": "a", "method": "standard"}]}
    result = extract_feature_importance("ridge", model, FEATURE_COLS, feature_spec)
    assert result is not None
    assert result["standardized"] is True
    assert result["scaling_methods"] == ["standard"]


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
