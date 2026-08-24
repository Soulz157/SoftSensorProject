"""CSV export of a committed artifact — DS-LAKE-021.

Streams row-group by row-group via pyarrow's ParquetFile.iter_batches(),
never decoding the source into one pandas DataFrame and never holding more
than one batch's decoded rows plus one chunk's encoded CSV text in memory
at a time. Both the source Parquet and the output CSV pass through
SpooledTemporaryFile objects (in-memory for a small artifact, rolled to
disk automatically past SPOOL_MAX_BYTES) rather than a single in-memory
`bytes` value each — the final-review fix for a real regression: an
earlier version used `iter_batches` for the DECODE step but still pulled
the whole source object into one `bytes` payload first and accumulated the
whole output CSV into one `io.StringIO` before a single PUT, so peak
memory scaled with artifact size despite the batched decode.
__status sidecar columns are dropped from the output; a Bad-status cell
writes as an empty CSV field, never the raw 0.0 frame_service.MISSING_VALUE
actually stores in the source Parquet (userDecisions, DS-LAKE-021).
"""

from __future__ import annotations

import hashlib
import tempfile

import pyarrow.parquet as pq

from intergrations.object_store import (
    ObjectStore,
    STATUS_BAD,
    STATUS_SUFFIX,
    TIMESTAMP_COLUMN,
)
from schemas.preprocess import ExportRequest, ExportStatsResponse

#: Batch size for iter_batches — large enough that a small artifact needs
#: one batch, small enough that a multi-million-row artifact never holds
#: more than this many rows decoded in memory at once.
BATCH_ROWS = 50_000

#: SpooledTemporaryFile threshold, for both the downloaded source and the
#: assembled CSV — below this many bytes each stays purely in-process
#: memory (no disk I/O for a small artifact); at or past it, each rolls
#: to a real temp file automatically. Same order of magnitude as
#: download_to_fileobj's own chunk size, not tied to it.
SPOOL_MAX_BYTES = 16 * 1024 * 1024


def export_artifact_csv(
    store: ObjectStore, request: ExportRequest
) -> ExportStatsResponse:
    with (
        tempfile.SpooledTemporaryFile(max_size=SPOOL_MAX_BYTES) as src,
        tempfile.SpooledTemporaryFile(max_size=SPOOL_MAX_BYTES) as dst,
    ):
        store.download_to_fileobj(request.source_key, src)
        src.seek(0)
        parquet_file = pq.ParquetFile(src)

        all_columns = list(parquet_file.schema_arrow.names)
        status_columns = {c for c in all_columns if c.endswith(STATUS_SUFFIX)}
        value_columns = [
            c
            for c in all_columns
            if c != TIMESTAMP_COLUMN and c not in status_columns
        ]
        output_columns = [TIMESTAMP_COLUMN, *value_columns]

        digest = hashlib.sha256()
        total_rows = 0
        size_bytes = 0
        header_written = False

        for record_batch in parquet_file.iter_batches(batch_size=BATCH_ROWS):
            batch_df = record_batch.to_pandas()

            for tag in value_columns:
                status_col = f"{tag}{STATUS_SUFFIX}"
                if status_col in batch_df.columns:
                    bad_mask = batch_df[status_col] == STATUS_BAD
                    # object dtype so a blanked cell can hold "" without
                    # pandas silently upcasting the whole column back to
                    # float NaN, which would round-trip through to_csv as
                    # an EMPTY field too — but only by pandas's own
                    # convention, not this function's explicit choice.
                    # Explicit beats implicit here: a Bad reading must be
                    # OBSERVABLY blank, not accidentally so.
                    col = batch_df[tag].astype(object)
                    col[bad_mask] = ""
                    batch_df[tag] = col

            chunk = batch_df[output_columns]
            # No file argument: returns this batch's CSV text as a str,
            # not written anywhere yet — kept to ONE batch's worth of
            # encoded text at a time, the property that makes total
            # memory independent of row count.
            chunk_text = chunk.to_csv(index=False, header=not header_written)
            chunk_bytes = chunk_text.encode("utf-8")

            digest.update(chunk_bytes)
            dst.write(chunk_bytes)
            size_bytes += len(chunk_bytes)
            total_rows += len(batch_df)
            header_written = True

        dst.seek(0)
        # DS-LAKE-021-T04: NestJS mints this — the EXPORT artifact's OWN
        # key, not a sidecar of the SOURCE artifact's key. Writing a
        # sidecar-derived key here used to land the export INSIDE the
        # source artifact's own prefix, making it unsafe to reclaim
        # independently (see this module's own docstring).
        export_key = request.target_key
        store.put_object_stream(
            export_key, dst, size_bytes, content_type="text/csv"
        )

    return ExportStatsResponse(
        object_key=export_key,
        row_count=total_rows,
        column_count=len(value_columns),
        size_bytes=size_bytes,
        checksum=digest.hexdigest(),
    )
