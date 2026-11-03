"""MODEL-SERVE-003. Batch mode: score an arbitrary input parquet already in
object storage against a PRODUCTION model version, chunked so peak memory
tracks one batch, not the file (T03) — the DS-LAKE-012 76MB-where-489KB
regression is exactly the failure class this guards against, moved to a new
call site.

Posts to the BATCH-* endpoints only, via api.py's mode-keyed `_ROUTES` — the
same structural guarantee score.py states about itself: there is no code
path here that could reach /claim, /score-claim, /log or /complete even by
mistake.

decisions.batch_input_is_pre_scale: the input carries the model's feature
columns in RAW engineering units, identical to MODEL-SERVE-002's synchronous
/predict contract. `to_model_ready` applies the SAME fitted transform that
endpoint uses, via `softsensor_scaling` — one implementation, not two that
could drift (decisions.serving_transform_is_an_extracted_module).
"""

from __future__ import annotations

from typing import Any

import numpy as np
import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq
from softsensor_scaling import assert_scaling_coverage, to_model_ready

from api import RunApi
from artifacts import ArtifactSet, PARQUET_CONTENT_TYPE
from config import SCRATCH, RunContext
from models import SEQUENCE_ALGORITHMS
from storage import download_verified, sha256_of, upload_artifacts
from windows import DEFAULT_SEQUENCE_LENGTH, build_inference_windows

# Rows per chunk — mirrors apps/python/services/export_service.py's own
# BATCH_ROWS, the one other bounded-read path in this system.
BATCH_SIZE = 50_000

OUTPUT_FILENAME = "output.parquet"
BATCH_MANIFEST_FILENAME = "batch_manifest.json"


def _assert_columns_present(parquet_file: pq.ParquetFile, feature_columns: list[str]) -> None:
    """Fail before spending any time scoring, and name the missing column —
    not pyarrow's own ArrowInvalid, which names a column and explains
    nothing (the same complaint this ledger makes about pyarrow elsewhere)."""
    available = set(parquet_file.schema_arrow.names)
    missing = [c for c in feature_columns if c not in available]
    if missing:
        raise RuntimeError(
            f"Input is missing required feature column(s): {sorted(missing)}"
        )


def _score_sequence_chunk(
    model: Any,
    chunk: np.ndarray,
    carry: np.ndarray,
    sequence_length: int,
) -> tuple[np.ndarray, np.ndarray]:
    """MODEL-SERVE-043. One chunk's predictions for a sequence model, NaN
    where a row has no complete `sequence_length`-row history (the first L-1
    rows of the file, or a window touching a NaN), plus the carry for the
    next chunk. File order is time order here: a batch input has no
    guaranteed timestamp, so there is no step check."""
    combined = np.vstack([carry, chunk]) if len(carry) else chunk
    scorable = np.concatenate(
        [np.zeros(len(carry), dtype=bool), np.ones(len(chunk), dtype=bool)]
    )
    X, positions = build_inference_windows(combined, sequence_length, scorable)
    predictions = np.full(len(chunk), np.nan)
    if len(positions):
        predictions[positions - len(carry)] = model.predict(X)
    keep = sequence_length - 1
    next_carry = combined[-keep:] if keep > 0 else combined[:0]
    return predictions, next_carry


def run_batch_scoring(context: RunContext, api: RunApi) -> int:
    SCRATCH.mkdir(parents=True, exist_ok=True)

    spec = api.claim()
    model_id = spec["modelId"]
    model_version_id = spec["modelVersionId"]
    feature_columns: list[str] = spec["featureColumns"]
    scalers: dict[str, str] = spec.get("scalers") or {}
    scaling_params: dict[str, dict[str, float]] = spec.get("scalingParams") or {}
    api.log(
        f"Batch claimed. model={model_id} version={model_version_id}, "
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
    # the same guard apps/serving's rows_to_predictions applies, shared via
    # softsensor_scaling so the two implementations cannot disagree about
    # which tags need recorded fit state (the empty-scaling-array trap).
    assert_scaling_coverage(feature_columns, scalers, scaling_params)

    parquet_file = pq.ParquetFile(input_path)
    _assert_columns_present(parquet_file, feature_columns)

    output_path = SCRATCH / OUTPUT_FILENAME
    writer: pq.ParquetWriter | None = None
    row_count = 0
    # MODEL-SERVE-043. lstm/gru score (n, L, features) windows. The last
    # L-1 scaled rows carry into the next chunk so a window can span a chunk
    # boundary; rows without a full history come out null (user decision
    # 2026-11-01), so the output keeps one row per input row.
    sequence = spec.get("algorithm") in SEQUENCE_ALGORITHMS
    sequence_length = int(spec.get("sequenceLength") or DEFAULT_SEQUENCE_LENGTH)
    carry = np.empty((0, len(feature_columns)))
    predicted_rows = 0
    try:
        for record_batch in parquet_file.iter_batches(
            batch_size=BATCH_SIZE, columns=feature_columns
        ):
            frame = record_batch.to_pandas()
            # Column ORDER enforced explicitly — iter_batches' projection
            # preserves the FILE's column order for the requested columns,
            # not necessarily feature_columns' own order, and that order is
            # what model.predict expects (MODEL-SERVE-002's own predict.py
            # states the identical requirement).
            frame = frame[feature_columns]

            scaled, _ = to_model_ready(
                frame, feature_columns, scalers, fitted_params=scaling_params
            )
            if sequence:
                predictions, carry = _score_sequence_chunk(
                    model,
                    scaled[feature_columns].to_numpy(dtype=float),
                    carry,
                    sequence_length,
                )
                predicted_rows += int(np.isfinite(predictions).sum())
            else:
                predictions = model.predict(scaled[feature_columns])

            out_frame = pd.DataFrame({"prediction": predictions})
            table = pa.Table.from_pandas(out_frame, preserve_index=False)
            if writer is None:
                writer = pq.ParquetWriter(output_path, table.schema)
            writer.write_table(table)
            row_count += len(out_frame)
    finally:
        if writer is not None:
            writer.close()

    if row_count == 0:
        raise RuntimeError("Input parquet has zero rows — nothing to score.")

    api.log(f"Scored {row_count} row(s).")
    if sequence:
        api.log(
            f"Sequence model (sequence_length={sequence_length}): "
            f"{predicted_rows} of {row_count} row(s) had a complete history; "
            f"{row_count - predicted_rows} left null."
        )

    output_checksum = sha256_of(output_path)
    manifest = {
        "modelId": model_id,
        "modelVersionId": model_version_id,
        "rowCount": row_count,
        "outputChecksum": output_checksum,
    }

    artifacts = ArtifactSet(SCRATCH)
    artifacts.add_existing(OUTPUT_FILENAME, output_path, PARQUET_CONTENT_TYPE)
    artifacts.add_json(BATCH_MANIFEST_FILENAME, manifest)
    uploaded = upload_artifacts(api, artifacts.as_outputs(), log_fn=api.log)

    api.complete(
        {
            "status": "SUCCEEDED",
            "rowCount": row_count,
            "outputChecksum": output_checksum,
            "uploaded": uploaded,
        }
    )
    api.log("Batch scoring complete.")
    return 0
