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
from softsensor_scaling import (
    assert_scaling_coverage,
    max_replay_lookback,
    to_model_ready,
)


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


def required_history_rows(descriptor: dict[str, Any]) -> int:
    """T06. How many consecutive prior observations this model's recipe
    reaches back over, computed from the recipe itself with the SAME
    function `artifact_service.prepare_holdout_for_run` refuses on — one
    implementation, not two (softsensor_scaling.max_replay_lookback).

    ROWS, NOT A DURATION, deliberately — see that function's own note. A
    `lag(k)` reaches back k ROWS; turning that into wall-clock time needs a
    sampling cadence that `feature_spec.json` does not record and no Prisma
    column holds. This repo already settled that axis one layer down, in
    the structurally identical holdout-replay check: "computed from the
    recipe's own compound lookback ... NOT re-derived from a
    duration/interval a caller would have to look up."

    Returns 0 when the descriptor carries no recipe (a spec written before
    the field was passed through) — absent is reported as unknown-depth,
    never as a fabricated number.
    """
    features = descriptor.get("features") or []
    if not features:
        return 0
    try:
        return max_replay_lookback(features)
    except (KeyError, TypeError, ValueError):
        # A recipe this process cannot read is not a reason to refuse a
        # request whose columns are all present — the depth is advisory
        # context on a refusal, not itself a gate.
        return 0


def assert_history_satisfies_target_derivation(
    descriptor: dict[str, Any], rows: list[dict[str, Any]]
) -> None:
    """T06. Read `derived_from_target` at LOAD time (the descriptor already
    carries it) and refuse a history-less request BEFORE predicting —
    predicting from imputed/absent lags returns a plausible number with no
    symptom, which is the failure mode this guard exists to prevent.

    The refusal names the recipe's own required depth (see
    `required_history_rows`) so the caller learns how far back its history
    must reach, not merely that a column was missing. The request contract
    carries pre-computed feature columns rather than a timestamped series
    (the contract boundary this feature deliberately kept: serving applies
    scaling only), so the depth is stated for the caller to satisfy
    upstream rather than verified here against timestamps this endpoint
    never receives.

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
        depth = required_history_rows(descriptor)
        depth_note = (
            f" This model's recipe reaches back {depth} consecutive prior "
            f"observation(s), so those column(s) must be computed from at "
            f"least that much history, at the cadence the dataset was "
            f"built at."
            if depth
            else ""
        )
        raise PredictError(
            f"This model is target-derived (depends on {sorted(derived)}) "
            f"and needs target history in every request row — missing "
            f"{sorted(set(missing))}.{depth_note}"
        )


def rows_to_predictions(
    model: Any, descriptor: dict[str, Any], rows: list[dict[str, Any]]
) -> tuple[list[float], pd.DataFrame]:
    """Returns `(predictions, scaled)` — MODEL-SERVE-005-T01 needs the
    model-ready frame `to_model_ready` already built here to compute its
    drift aggregates over the SAME values the model actually scored,
    without re-scaling anything a second time."""
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
    return [float(p) for p in predicted], scaled[feature_columns]
