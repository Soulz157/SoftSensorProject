"""MODEL-SERVE-027, found live 2026-10-02: a nan metric failed the whole run
at completion. api.json_safe turns non-finite floats into null."""

from __future__ import annotations

import json
import math

import numpy as np

from api import json_safe


def test_nan_and_inf_become_null_everywhere_and_the_payload_serialises() -> None:
    payload = {
        "status": "SUCCEEDED",
        "metrics": {"r2": -8.72, "rmse": 15.4},
        "holdoutMetrics": {"r2": float("nan"), "mae": 0.3, "rows": 1},
        "splitSpec": {"folds": [{"r2": float("inf")}, {"r2": float("-inf")}]},
        "numpy": float(np.float64("nan")),
    }
    safe = json_safe(payload)
    assert safe["holdoutMetrics"]["r2"] is None
    assert safe["splitSpec"]["folds"] == [{"r2": None}, {"r2": None}]
    assert safe["numpy"] is None
    # finite values untouched
    assert safe["metrics"] == {"r2": -8.72, "rmse": 15.4}
    assert safe["holdoutMetrics"]["mae"] == 0.3 and safe["holdoutMetrics"]["rows"] == 1
    json.dumps(safe, allow_nan=False)  # the exact check requests applies


def test_the_original_payload_still_fails_without_it() -> None:
    try:
        json.dumps({"r2": math.nan}, allow_nan=False)
    except ValueError as exc:
        assert "not JSON compliant" in str(exc)
    else:  # pragma: no cover
        raise AssertionError("expected nan to be refused")
