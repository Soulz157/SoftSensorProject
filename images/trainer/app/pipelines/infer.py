"""MODEL-SERVE-006. Infer mode: score ONE scheduled window's already-
materialized, pre-scale input against its PINNED model version.

Structurally batch.py one entity over — this container never fetches from
a source system and never computes features; apps/python's own
`materialize_window` already did both and wrote a clean, pre-scale
input.parquet (D1: decisions.batch_input_is_pre_scale applies identically
here). This entrypoint's whole job is claim -> download -> to_model_ready
-> predict -> upload.

Posts to the INFER-* endpoints only, via api.py's mode-keyed `_ROUTES` —
same structural guarantee batch.py/score.py each state about themselves:
there is no code path here that could reach /claim, /score-claim,
/batch-claim, /log, or /complete even by mistake.

decisions.batch_input_is_pre_scale: the input carries the model's feature
columns in RAW engineering units, identical to MODEL-SERVE-002's
synchronous /predict and MODEL-SERVE-003's batch input. `to_model_ready`
applies the SAME fitted transform those paths use, via `softsensor_scaling`
— one implementation, not three that could drift.
"""

from __future__ import annotations

import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq
from softsensor_scaling import assert_scaling_coverage, to_model_ready

from api import RunApi
from artifacts import ArtifactSet, PARQUET_CONTENT_TYPE
from config import SCRATCH, TIMESTAMP_COLUMN, RunContext
from storage import download_verified, sha256_of, upload_artifacts

OUTPUT_FILENAME = "predictions.parquet"
METRICS_FILENAME = "metrics.json"


def _assert_columns_present(
    available: set[str], feature_columns: list[str]
) -> None:
    missing = [c for c in feature_columns if c not in available]
    if missing:
        raise RuntimeError(
            f"Input is missing required feature column(s): {sorted(missing)}"
        )


def run_inference(context: RunContext, api: RunApi) -> int:
    SCRATCH.mkdir(parents=True, exist_ok=True)

    spec = api.claim()
    model_id = spec["modelId"]
    model_version_id = spec["modelVersionId"]
    feature_columns: list[str] = spec["featureColumns"]
    scalers: dict[str, str] = spec.get("scalers") or {}
    scaling_params: dict[str, dict[str, float]] = spec.get("scalingParams") or {}
    window_start = spec["windowStart"]
    window_end = spec["windowEnd"]
    api.log(
        f"Window claimed. model={model_id} version={model_version_id}, "
        f"window=[{window_start}, {window_end}), "
        f"{len(feature_columns)} feature column(s)."
    )

    model_path, _ = download_verified(
        spec["modelUrl"], SCRATCH / "model.joblib", spec["modelChecksum"], "Model"
    )
    import joblib

    model = joblib.load(model_path)

    input_path, _ = download_verified(
        spec["inputUrl"], SCRATCH / "input.parquet", spec["inputChecksum"], "Input"
    )

    # Refuse an uncovered feature column BEFORE spending any time scoring —
    # the same guard apps/serving's rows_to_predictions and pipelines/
    # batch.py both apply, shared via softsensor_scaling so no
    # implementation can disagree about which tags need recorded fit state
    # (the empty-scaling-array trap).
    assert_scaling_coverage(feature_columns, scalers, scaling_params)

    parquet_file = pq.ParquetFile(input_path)
    _assert_columns_present(set(parquet_file.schema_arrow.names), feature_columns)

    # A window is small by construction (one cadence's worth of rows, not
    # an arbitrary upload) — a single read is simpler than batch.py's
    # chunked iter_batches, and correct for the same reason: nothing here
    # approaches that entrypoint's large-arbitrary-upload memory concern.
    table = pq.read_table(input_path, columns=[TIMESTAMP_COLUMN] + feature_columns)
    frame = table.to_pandas()
    # Column ORDER enforced explicitly, same requirement batch.py/apps/
    # serving's predict.py both state on themselves — projection preserves
    # the FILE's column order for the requested columns, not necessarily
    # feature_columns' own order, and that order is what model.predict
    # expects.
    timestamps = frame[TIMESTAMP_COLUMN]
    feature_frame = frame[feature_columns]

    scaled, _ = to_model_ready(
        feature_frame, feature_columns, scalers, fitted_params=scaling_params
    )
    predictions = model.predict(scaled[feature_columns])

    out_frame = pd.DataFrame(
        {TIMESTAMP_COLUMN: timestamps.to_numpy(), "prediction": predictions}
    )
    row_count = len(out_frame)
    if row_count == 0:
        raise RuntimeError("Input parquet has zero rows — nothing to score.")

    api.log(f"Scored {row_count} row(s).")

    output_path = SCRATCH / OUTPUT_FILENAME
    table = pa.Table.from_pandas(out_frame, preserve_index=False)
    pq.write_table(table, output_path)
    output_checksum = sha256_of(output_path)

    # D6: no `actual`, and this metrics.json says so structurally by
    # omission rather than by a null field a reader might mistake for a
    # zero — ground truth is not joined at this stage (MODEL-SERVE-005-T03
    # remains blocked), so no r2/RMSE is computed here. T08 (a later pass)
    # is where the registry states that boundary explicitly.
    pred_series = out_frame["prediction"]
    metrics = {
        "modelId": model_id,
        "modelVersionId": model_version_id,
        "windowStart": window_start,
        "windowEnd": window_end,
        "rowCount": row_count,
        "predictionMin": float(pred_series.min()),
        "predictionMean": float(pred_series.mean()),
        "predictionMax": float(pred_series.max()),
        "predictionStd": float(pred_series.std(ddof=0)) if row_count > 1 else 0.0,
    }

    artifacts = ArtifactSet(SCRATCH)
    artifacts.add_existing(OUTPUT_FILENAME, output_path, PARQUET_CONTENT_TYPE)
    artifacts.add_json(METRICS_FILENAME, metrics)
    uploaded = upload_artifacts(api, artifacts.as_outputs(), log_fn=api.log)

    api.complete(
        {
            "status": "SUCCEEDED",
            "rowCount": row_count,
            "outputChecksum": output_checksum,
            "uploaded": uploaded,
        }
    )
    api.log("Inference window complete.")
    return 0
