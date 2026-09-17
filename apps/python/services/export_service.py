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

DS-LAKE-028-T05: values are INVERTED back to engineering units before they
are written. A saved dataset's FINAL is model-ready by construction, so
this file used to leave the system as a min-max normalized frame presented
as the dataset's data — the one surface here whose output gets read against
historian values. The artifact's own bytes are NOT rewritten; the inverse is
computed on the way out, from the `feature_spec.json` the caller names, and
is APPROXIMATE by the +/-0.001 * span the scaler's own rounding introduced.
A column no inverse can recover (robust fitted with iqr == 0) REFUSES the
export rather than writing a 0.0 that reads as a measurement.
"""

from __future__ import annotations

import hashlib
import tempfile

import numpy as np
import pyarrow.parquet as pq
from softsensor_scaling import NotInvertibleError, inverse_scale_column

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


def _load_scaling_params(
    store: ObjectStore, feature_spec_key: str | None
) -> dict[str, dict[str, float]]:
    """The fitted scaler params for this artifact, or {} when there are none.

    `scalingParams` is the authoritative record of what was fitted and is
    read directly; `scaling` is NOT consulted, at any featureVersion. Every
    spec written before DS-LAKE-028-T02 holds `scaling: []` while its data
    IS fully scaled, so branching on that field would silently export a
    normalized frame as though it were engineering units — the exact defect
    this task exists to close.

    A null key is not an error. An EXPORT whose source has no spec (nothing
    was ever scaled, or the artifact predates the sidecar) exports the bytes
    as they are, which is correct for an unscaled frame.
    """
    if not feature_spec_key:
        return {}
    spec = store.get_json(feature_spec_key)
    params = spec.get("scalingParams") or {}
    return {tag: dict(entry) for tag, entry in params.items()}


def _assert_every_column_is_invertible(
    value_columns: list[str],
    scaling_params: dict[str, dict[str, float]],
) -> None:
    """Refuse an export carrying a column whose transform cannot be undone.

    Only `robust` fitted with `iqr == 0` qualifies: it stored 0.0 for every
    row and kept no record of what they held. Writing that 0.0 out under an
    engineering-unit heading is the same defect DS-LAKE-021's own status
    column decision already refused once — "a Bad cell reads as a real
    measurement of zero, and the reader has no way to tell". As of
    2026-09-16 no live spec has a robust scaler at all (all 462 recorded
    entries across 22 specs are minmax), so this is a guard with no current
    instance, not a common path.
    """
    refused = []
    for tag in value_columns:
        params = scaling_params.get(tag)
        if params and params.get("iqr") == 0 and "median" in params:
            refused.append(tag)
    if refused:
        raise NotInvertibleError(
            f"Export refused: {sorted(refused)} were scaled with a robust "
            "scaler fitted at iqr == 0, which stored 0.0 for every row and "
            "recorded nothing about the values themselves. Exporting them "
            "would present 0.0 as a measurement."
        )


def export_artifact_csv(
    store: ObjectStore, request: ExportRequest
) -> ExportStatsResponse:
    with (
        tempfile.SpooledTemporaryFile(max_size=SPOOL_MAX_BYTES) as src,
        tempfile.SpooledTemporaryFile(max_size=SPOOL_MAX_BYTES) as dst,
    ):
        # ONE read, BEFORE the stream opens — never per batch. DS-LAKE-021-T01
        # rewrote this function specifically to keep peak memory independent
        # of row count (18.2x -> 3.65x growth for a 100x row increase); a
        # sidecar read inside the loop would not blow memory but would issue
        # one object GET per 50,000 rows, and the buffered pattern that
        # rewrite removed is exactly the shape a careless addition restores.
        scaling_params = _load_scaling_params(store, request.feature_spec_key)

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

        # Refuse the WHOLE export up front if any column cannot be recovered,
        # not partway through a stream that has already written rows: a
        # half-written CSV whose tail is missing is worse than no CSV.
        _assert_every_column_is_invertible(value_columns, scaling_params)

        for record_batch in parquet_file.iter_batches(batch_size=BATCH_ROWS):
            batch_df = record_batch.to_pandas()

            for tag in value_columns:
                params = scaling_params.get(tag)
                if params is not None:
                    # Inverted BEFORE the Bad-cell blanking below, while the
                    # column is still numeric. Order matters: blanking casts
                    # to object dtype, and a 0.0 MISSING_VALUE inverts to the
                    # scaler's own centre — a real-looking number — so it must
                    # be overwritten with "" afterwards, never before.
                    batch_df[tag] = inverse_scale_column(
                        np.asarray(batch_df[tag], dtype=float), params
                    )

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
