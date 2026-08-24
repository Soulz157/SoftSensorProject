"""CSV export of a committed artifact — DS-LAKE-021.

Streams row-group by row-group via pyarrow's ParquetFile.iter_batches(),
never materialising the full frame in memory (the same discipline
validate/materialize already follow, per DS-LAKE-005B-C-T07's own
peak_rss_kb precedent). __status sidecar columns are dropped from the
output; a Bad-status cell writes as an empty CSV field, never the raw
0.0 frame_service.MISSING_VALUE actually stores in the source Parquet
(userDecisions, DS-LAKE-021).
"""

from __future__ import annotations

import io

import pyarrow.parquet as pq

from intergrations.object_store import (
    EXPORT_CSV_FILENAME,
    ObjectStore,
    STATUS_BAD,
    STATUS_SUFFIX,
    TIMESTAMP_COLUMN,
    sidecar_key,
)
from schemas.preprocess import ExportRequest, ExportStatsResponse

#: Batch size for iter_batches — large enough that a small artifact needs
#: one batch, small enough that a multi-million-row artifact never holds
#: more than this many rows in memory at once.
BATCH_ROWS = 50_000


def export_artifact_csv(
    store: ObjectStore, request: ExportRequest
) -> ExportStatsResponse:
    payload = store.get_object_bytes(request.source_key)
    buffer = io.BytesIO(payload)
    parquet_file = pq.ParquetFile(buffer)

    all_columns = list(parquet_file.schema_arrow.names)
    status_columns = {c for c in all_columns if c.endswith(STATUS_SUFFIX)}
    value_columns = [
        c for c in all_columns if c != TIMESTAMP_COLUMN and c not in status_columns
    ]
    output_columns = [TIMESTAMP_COLUMN, *value_columns]

    out = io.StringIO()
    total_rows = 0
    header_written = False

    for record_batch in parquet_file.iter_batches(batch_size=BATCH_ROWS):
        batch_df = record_batch.to_pandas()

        for tag in value_columns:
            status_col = f"{tag}{STATUS_SUFFIX}"
            if status_col in batch_df.columns:
                bad_mask = batch_df[status_col] == STATUS_BAD
                # object dtype so a blanked cell can hold "" without pandas
                # silently upcasting the whole column back to float NaN,
                # which would round-trip through to_csv as an EMPTY field
                # too — but only by pandas's own convention, not this
                # function's explicit choice. Explicit beats implicit here:
                # a Bad reading must be OBSERVABLY blank, not accidentally so.
                col = batch_df[tag].astype(object)
                col[bad_mask] = ""
                batch_df[tag] = col

        chunk = batch_df[output_columns]
        chunk.to_csv(out, index=False, header=not header_written, mode="a")
        header_written = True
        total_rows += len(batch_df)

    csv_bytes = out.getvalue().encode("utf-8")
    export_key = sidecar_key(request.source_key, EXPORT_CSV_FILENAME)
    store.put_object_bytes(export_key, csv_bytes)

    return ExportStatsResponse(
        object_key=export_key,
        row_count=total_rows,
        column_count=len(value_columns),
        size_bytes=len(csv_bytes),
        checksum=store.checksum_of(export_key),
    )
