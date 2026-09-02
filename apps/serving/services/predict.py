"""MODEL-SERVE-002-T04/T05/T06. Validate a request against
`feature_columns`, apply the SAME transform training used, predict.

T05's answer: the transform is `softsensor_scaling.to_model_ready` — the
same function `apps/python` imports, extracted precisely so the two cannot
disagree (decisions.serving_transform_is_an_extracted_module). This module
never re-implements scaling; it only orchestrates rows -> frame -> transform
-> predict -> rows.
"""

from __future__ import annotations

from typing import Any

import pandas as pd
from softsensor_scaling import assert_scaling_coverage, to_model_ready


class PredictError(ValueError):
    """Safe to surface to the /predict caller as a 422 — never a bare 500."""


def _validate_rows(
    rows: list[dict[str, Any]], feature_columns: list[str]
) -> None:
    """Presence, per row, with the offending column NAMED — not sklearn's
    own message, which names a column and explains nothing (T04's own
    acceptance criterion)."""
    for i, row in enumerate(rows):
        missing = [c for c in feature_columns if c not in row]
        if missing:
            raise PredictError(
                f"Row {i} is missing required column(s): {sorted(missing)}"
            )
        non_numeric = [
            c
            for c in feature_columns
            if not isinstance(row[c], (int, float)) or isinstance(row[c], bool)
        ]
        if non_numeric:
            raise PredictError(
                f"Row {i} has non-numeric value(s) for column(s): "
                f"{sorted(non_numeric)}"
            )


def assert_history_satisfies_target_derivation(
    descriptor: dict[str, Any], rows: list[dict[str, Any]]
) -> None:
    """T06. Read `derived_from_target` at LOAD time (the descriptor already
    carries it) and refuse a history-less request BEFORE predicting —
    predicting from imputed/absent lags returns a plausible number with no
    symptom, which is the failure mode this guard exists to prevent.

    0 of 21 live feature_spec.json objects have a non-empty
    derived_from_target as of this feature's own audit — this guard is
    therefore a no-op on every model currently in this system, and is
    exercised only against a fabricated fixture (MODEL-SERVE-002-V03).
    """
    derived = descriptor.get("derivedFromTarget") or []
    if not derived:
        return
    missing = [c for c in derived if any(c not in row for row in rows)]
    if missing:
        raise PredictError(
            f"This model is target-derived (depends on {sorted(derived)}) "
            f"and needs target history in every request row — missing "
            f"{sorted(set(missing))}."
        )


def rows_to_predictions(
    model: Any, descriptor: dict[str, Any], rows: list[dict[str, Any]]
) -> list[float]:
    feature_columns: list[str] = descriptor["featureColumns"]
    _validate_rows(rows, feature_columns)

    frame = pd.DataFrame(rows)
    # Column ORDER enforced explicitly, before to_model_ready — this is the
    # exact order model.predict expects (run_manifest.json's own
    # feature_columns, per artifact_service.py's own comment: "no DB column
    # carries this").
    try:
        frame = frame[feature_columns]
    except KeyError as exc:
        raise PredictError(
            f"Request rows do not carry the model's feature columns: {exc}"
        ) from exc

    scalers: dict[str, str] = descriptor.get("scalers") or {}
    scaling_params: dict[str, dict[str, float]] = (
        descriptor.get("scalingParams") or {}
    )

    # Same coverage guard prepare_holdout_for_run applies before its own
    # to_model_ready call (artifact_service.py, now shared via
    # softsensor_scaling — decisions.serving_transform_is_an_extracted_
    # module). Without this, a feature column absent from scalingParams
    # would silently re-fit on THIS REQUEST's own (often single-row,
    # degenerate) statistics — catastrophic for standard/robust scalers,
    # and silently wrong for minmax on anything but the training range.
    try:
        assert_scaling_coverage(feature_columns, scalers, scaling_params)
    except ValueError as exc:
        raise PredictError(str(exc)) from exc

    scaled, _ = to_model_ready(
        frame, feature_columns, scalers, fitted_params=scaling_params
    )
    predicted = model.predict(scaled[feature_columns])
    return [float(p) for p in predicted]
