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

import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq
from softsensor_scaling import assert_scaling_coverage, to_model_ready

from api import RunApi
from artifacts import ArtifactSet, PARQUET_CONTENT_TYPE
from config import SCRATCH, RunContext
from storage import download_verified, sha256_of, upload_artifacts

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
