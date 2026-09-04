"""MODEL-SERVE-005-T01. Write and read sampled synchronous-/predict rows.

NestJS calls `append` once per LOGGED request (apps/serving already decided
whether this request is logged, at what sampling rate, and which rows to
keep — see prediction_log.py on that side); `series` walks the dt=/hour=
partitions `append` created to answer a time-range read for the Monitoring
page.

What this module deliberately does NOT do: compute drift, compute the
sufficient-statistics aggregates (featureStats/predictionStats), or read
column_stats.json. Those live in apps/backend's lib/prediction-drift.ts —
apps/serving already has the model-ready frame in memory when it computes
the aggregates, so routing them through here would be a second network hop
for arithmetic the caller can already do, the same reasoning that kept T05's
drift math out of a new Python endpoint (docs/feature_list_model.json).
"""

from __future__ import annotations

import io
from datetime import datetime, timezone

import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq

from intergrations.object_store import (
    ObjectStore,
    serving_log_key,
    serving_log_prefix,
    sha256_hex,
)
from schemas.preprocess import (
    PredictionLogAppendRequest,
    PredictionLogPoint,
    PredictionLogSeriesRequest,
)

#: Same reasoning as SERVING_MAX_ROWS one layer up (apps/serving) — this is
#: a cap on RESPONSE size for a chart, not a data-retention limit. The
#: objects themselves are untouched; a caller wanting more narrows the
#: range instead.
PREDICTION_LOG_SERIES_CAP = 5000

_PREDICTION_COLUMN = "prediction"
_TIMESTAMP_COLUMN = "timestamp"


def _to_parquet_bytes(frame: pd.DataFrame) -> bytes:
    buf = io.BytesIO()
    pq.write_table(pa.Table.from_pandas(frame, preserve_index=False), buf)
    return buf.getvalue()


def append(store: ObjectStore, request: PredictionLogAppendRequest) -> dict:
    """Write one logged request's capped rows as a single Parquet object.

    Every row shares `requested_at` as its timestamp — the request happened
    at one instant; `apps/serving` assigns no per-row time because
    `/predict`'s own contract (MODEL-SERVE-002) carries no timestamp field
    per row, and inventing one here would be a fabricated value presented as
    observed data.

    Not routed through `put_frame`: that method enforces the dataset-lake
    tag/`{tag}__status` shape (`assert_frame_shape`), which a prediction log
    is not — a feature column here may collide with that convention's
    reserved suffix, and this object has no status sidecar concept at all.
    `put_object_bytes` is the same primitive `put_frame` writes atop, minus
    that shape check.
    """
    frame = pd.DataFrame(
        [{**row.features, _PREDICTION_COLUMN: row.prediction} for row in request.rows]
    )
    frame.insert(0, _TIMESTAMP_COLUMN, request.requested_at)

    payload = _to_parquet_bytes(frame)
    ts = request.requested_at.astimezone(timezone.utc)
    key = serving_log_key(
        request.model_id,
        request.model_version_id,
        ts.strftime("%Y-%m-%d"),
        ts.strftime("%H"),
    )
    store.put_object_bytes(key, payload, content_type="application/vnd.apache.parquet")

    return {
        "object_key": key,
        "object_checksum": sha256_hex(payload),
        "row_count": int(len(frame)),
    }


def _hour_range(start: datetime, end: datetime) -> list[tuple[str, str]]:
    """Every (dt, hour) bucket that could contain a point in [start, end],
    inclusive on both ends — the write side floors to the hour, so a point
    at 08:59 lives in the `hour=08` partition even though `end` might be
    08:30; walking from `start`'s own hour through `end`'s hour, both
    floored, covers every bucket that could hold an in-range row without
    listing the whole model-version prefix.
    """
    start = start.astimezone(timezone.utc).replace(minute=0, second=0, microsecond=0)
    end = end.astimezone(timezone.utc).replace(minute=0, second=0, microsecond=0)
    buckets: list[tuple[str, str]] = []
    cursor = start
    while cursor <= end:
        buckets.append((cursor.strftime("%Y-%m-%d"), cursor.strftime("%H")))
        cursor = cursor + pd.Timedelta(hours=1)
    return buckets


def series(store: ObjectStore, request: PredictionLogSeriesRequest) -> dict:
    """Every logged row for one model version in [from, to], oldest first.

    Lists each candidate hour partition (`ObjectStore.list_object_keys`,
    MODEL-SERVE-005's own addition) rather than maintaining a separate
    index of which hours have objects — an hour with nothing logged simply
    lists empty, the same "absence is not an error" discipline
    `list_object_keys` itself documents.
    """
    range_from = request.range_from.astimezone(timezone.utc)
    range_to = request.range_to.astimezone(timezone.utc)

    points: list[PredictionLogPoint] = []
    truncated = False
    for dt, hour in _hour_range(range_from, range_to):
        prefix = serving_log_prefix(request.model_id, request.model_version_id, dt, hour)
        for key in store.list_object_keys(prefix):
            frame = store.get_frame(key)
            if _TIMESTAMP_COLUMN not in frame.columns:
                continue
            ts_col = pd.to_datetime(frame[_TIMESTAMP_COLUMN], utc=True)
            mask = (ts_col >= range_from) & (ts_col <= range_to)
            for idx in frame.index[mask]:
                if len(points) >= PREDICTION_LOG_SERIES_CAP:
                    truncated = True
                    break
                row = frame.loc[idx]
                features = {
                    col: float(row[col])
                    for col in frame.columns
                    if col not in (_TIMESTAMP_COLUMN, _PREDICTION_COLUMN)
                }
                points.append(
                    PredictionLogPoint(
                        timestamp=ts_col.loc[idx].to_pydatetime(),
                        prediction=float(row[_PREDICTION_COLUMN]),
                        features=features,
                    )
                )
            if truncated:
                break
        if truncated:
            break

    points.sort(key=lambda p: p.timestamp)
    return {"points": points, "truncated": truncated}
