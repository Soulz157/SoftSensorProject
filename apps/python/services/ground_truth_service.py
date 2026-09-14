"""MODEL-SERVE-005-T03. Join ONE scheduled window's late-arriving ground
truth to the predictions that window already produced.

Division of labour, restated from `inference_window_service.py`'s own
header because it applies identically: NestJS owns the schedule, the window
row and the join's idempotency (one `InferenceWindowTruth` row per window);
this module owns the data and holds the only source credentials in the
call. It returns SUMS, never a finished metric — `lib/live-error.ts`
computes r2/rmse/mae/sd on the NestJS side, the same split
MODEL-SERVE-005-T01 already draws for prediction logging.

WHY THIS IS NOT A SECOND `materialize_window`. That function fetches the
FEATURE set on the schedule's short ingestion lag, replays the pinned
recipe over a widened frame, and writes a scoring input. This one fetches
ONE column — the target — on a much longer lag, replays nothing (the
target is a base tag, so there is no lookback to pad), and joins against an
object that already exists. They share the `pi | sql` fork and the
never-impute rule; nothing else.

THE ONE CORRECTNESS RULE: a truth value must be evidenced by an actual lab
event inside the interval, never by a held or interpolated summary. PI
holds a sparse `.lab` tag's last value between samples, so the schedule's
own `TimeWeighted`/`Average` fetch config returns a plausible number for
EVERY interval — including every interval in which no measurement was ever
taken. Inheriting it would publish a confident R2 computed against a held
value, with no error anywhere to point at: exactly the plausible-wrong-
answer failure this ledger's global_definition_of_done forbids. The PI
branch therefore probes for event presence first and keeps only intervals
that actually carry a lab event.
"""

from __future__ import annotations

import asyncio
import io
from typing import Any

import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq

from intergrations.object_store import (
    INFERENCE_TRUTH_FILENAME,
    STATUS_GOOD,
    TIMESTAMP_COLUMN,
    inference_window_key,
    sha256_hex,
    status_column,
)
from schemas.preprocess import (
    InferenceWindowTruthJoinRequest,
    InferenceWindowTruthSeriesRequest,
)
from services.data_source_service import PIDataSourceService, SQLDataSourceService
from services.frame_service import (
    from_pi_response,
    from_sql_response,
    utc_to_wall_clock,
)

_pi = PIDataSourceService()
_sql = SQLDataSourceService()

#: Same format `inference_window_service` uses, for the same reason — a
#: naive absolute string every downstream parser here already accepts.
_TIME_FMT = "%Y-%m-%d %H:%M:%S.%f"

_PREDICTION_COLUMN = "prediction"


def _as_mapping(response: Any) -> dict[str, Any]:
    """Pydantic response -> plain dict for `frame_service`. Kept local for
    the reason `inference_window_service._as_mapping` states on itself."""
    return response.model_dump() if hasattr(response, "model_dump") else dict(response)


def _to_parquet_bytes(frame: pd.DataFrame) -> bytes:
    """Written through pyarrow directly rather than `store.put_frame`, the
    same reasoning `prediction_log_service._to_parquet_bytes` states: this
    frame carries (timestamp, predicted, actual, residual) and does not
    follow the dataset-lake tag/`__status` shape `assert_frame_shape`
    enforces.
    """
    buffer = io.BytesIO()
    pq.write_table(pa.Table.from_pandas(frame, preserve_index=False), buffer)
    return buffer.getvalue()


def _empty_truth(tag: str) -> pd.DataFrame:
    return pd.DataFrame({TIMESTAMP_COLUMN: [], tag: [], status_column(tag): []})


def _empty_result(prediction_rows: int, truth_rows: int = 0) -> dict[str, Any]:
    """No pairs — no object written, every sum zero WITH `n = 0` beside it.

    The caller must read `n`, never the sums alone: treating all-zero sums
    as an error of zero would publish a perfect score for a window no lab
    has reported on yet.
    """
    return {
        "object_key": None,
        "checksum": None,
        "truth_rows": truth_rows,
        "prediction_rows": prediction_rows,
        "paired_rows": 0,
        "n": 0,
        "sum_se": 0.0,
        "sum_ae": 0.0,
        "sum_signed": 0.0,
        "sum_actual": 0.0,
        "sum_actual_sq": 0.0,
    }


def _fetch_truth_frame(
    request: InferenceWindowTruthJoinRequest,
    fetch_start: pd.Timestamp,
    fetch_end: pd.Timestamp,
) -> pd.DataFrame:
    """The target tag alone over the fetch range, as a canonical frame.

    PI branch: TWO calls, deliberately. `from_pi_response` builds one value
    per (tag, timestamp), so a single call asking for both `Count` and
    `Average` would collide two summaries into one column. The first call
    is an `EventWeighted`/`Count` probe establishing WHETHER a lab event
    exists in each interval; the second reads the value. Intervals with a
    zero or absent count are dropped before the value is ever looked at —
    that is what keeps PI's held-forever last value out of the join.

    SQL branch: one query. A SQL source stores rows, not a held signal, so
    an interval with no lab result carries NULL, which `from_sql_response`
    already turns into a Bad hole — absence survives the fetch on its own.
    """
    tag = request.target_column
    start = fetch_start.strftime(_TIME_FMT)
    end = fetch_end.strftime(_TIME_FMT)

    if request.pi is not None:
        base = request.pi.model_copy(
            update={
                "tag_list": [tag],
                "start_time": start,
                "end_time": end,
                # NOT the schedule's cal_basis. A time-weighted summary of a
                # sparse lab tag integrates the held value across the whole
                # interval and therefore always returns something.
                "cal_basis": "EventWeighted",
            }
        )
        interval = base.summary_duration or "1m"

        counts = from_pi_response(
            _as_mapping(
                asyncio.run(
                    _pi.fetch(
                        base.model_copy(update={"summary_type": ["Count"]}),
                        interval=interval,
                    )
                )
            )
        )
        values = from_pi_response(
            _as_mapping(
                asyncio.run(
                    _pi.fetch(
                        base.model_copy(update={"summary_type": ["Average"]}),
                        interval=interval,
                    )
                )
            )
        )

        if tag not in values.columns:
            return _empty_truth(tag)
        if tag not in counts.columns:
            # No probe result at all is not licence to trust the values —
            # absence of evidence is exactly what this branch refuses to
            # treat as evidence.
            return values.iloc[0:0]

        # An interval survives only if the probe SAW an event there. A Bad
        # count is "the probe failed", not "zero events", and is dropped for
        # the same reason: it is not evidence either way.
        count_status = status_column(tag)
        evidenced = counts[(counts[count_status] == STATUS_GOOD) & (counts[tag] > 0)][
            TIMESTAMP_COLUMN
        ]
        return values[values[TIMESTAMP_COLUMN].isin(evidenced)].reset_index(drop=True)

    sql_spec = request.sql
    assert sql_spec is not None  # guaranteed by the request's own validator
    widened_query = sql_spec.query.model_copy(
        update={"start_time": start, "end_time": end}
    )
    return from_sql_response(
        _as_mapping(_sql.query(widened_query)),
        timestamp_column=sql_spec.timestamp_column,
        tags=[tag],
    )


def join_window_truth(
    store, request: InferenceWindowTruthJoinRequest
) -> dict[str, Any]:
    """Returns `InferenceWindowTruthJoinResponse`'s own field set.

    Join semantics mirror `apps/client/lib/lab-ingestion.ts`'s
    `alignLabToPredictions` EXACTLY, so the server and the Evaluation tab
    cannot disagree about what "aligned" means: each lab sample takes its
    NEAREST prediction within tolerance, and where several lab samples snap
    to one prediction the CLOSEST wins — one pair per prediction timestamp,
    never several pairs sharing one predicted value.
    """
    tag = request.target_column

    predictions = store.get_frame(request.predictions_key)
    if _PREDICTION_COLUMN not in predictions.columns:
        raise ValueError(
            f"'{request.predictions_key}' has no '{_PREDICTION_COLUMN}' column — "
            "this is not an inference window's predictions object."
        )
    prediction_rows = int(len(predictions))
    if prediction_rows == 0:
        return _empty_result(0)

    window_start = utc_to_wall_clock(request.window_start)
    window_end = utc_to_wall_clock(request.window_end)
    tolerance = pd.Timedelta(seconds=request.tolerance_seconds)

    # Widened by the tolerance on BOTH sides: a lab sample taken just before
    # a window opened or just after it closed can still legitimately pair
    # with a prediction inside it, and the tolerance is the stated rule for
    # how near is near enough.
    truth = _fetch_truth_frame(
        request, window_start - tolerance, window_end + tolerance
    )

    if tag not in truth.columns or len(truth) == 0:
        return _empty_result(prediction_rows)

    # NEVER IMPUTED, the same rule and the same reason `drop_bad_feature_
    # rows` states on the feature side: a Bad cell is an absent measurement,
    # and filling it would manufacture the very ground truth this join
    # exists to measure against. Dropped here rather than filtered later so
    # `truth_rows` counts real lab samples only.
    status = status_column(tag)
    if status in truth.columns:
        truth = truth[truth[status] == STATUS_GOOD]
    truth = truth[[TIMESTAMP_COLUMN, tag]].dropna()
    truth_rows = int(len(truth))
    if truth_rows == 0:
        return _empty_result(prediction_rows)

    left = (
        truth.rename(columns={tag: "actual"})
        .sort_values(TIMESTAMP_COLUMN)
        .reset_index(drop=True)
    )
    right = (
        predictions[[TIMESTAMP_COLUMN, _PREDICTION_COLUMN]]
        .rename(columns={_PREDICTION_COLUMN: "predicted"})
        .sort_values(TIMESTAMP_COLUMN)
        .reset_index(drop=True)
    )
    left[TIMESTAMP_COLUMN] = pd.to_datetime(left[TIMESTAMP_COLUMN])
    right[TIMESTAMP_COLUMN] = pd.to_datetime(right[TIMESTAMP_COLUMN])

    paired = pd.merge_asof(
        left,
        right.rename(columns={TIMESTAMP_COLUMN: "prediction_timestamp"}),
        left_on=TIMESTAMP_COLUMN,
        right_on="prediction_timestamp",
        direction="nearest",
        tolerance=tolerance,
    )
    # A lab sample with no prediction inside tolerance is DROPPED, never
    # snapped to a distant one — the boundary is the point of the tolerance.
    paired = paired[paired["prediction_timestamp"].notna()]
    if len(paired) == 0:
        return _empty_result(prediction_rows, truth_rows)

    # One pair per PREDICTION, closest lab sample wins. Without this a lab
    # instrument sampling faster than the scoring cadence contributes
    # several pairs sharing one predicted value, quietly weighting that one
    # prediction several times in the pooled metric.
    paired["distance"] = (
        paired[TIMESTAMP_COLUMN] - paired["prediction_timestamp"]
    ).abs()
    paired = (
        paired.sort_values("distance")
        .drop_duplicates(subset="prediction_timestamp", keep="first")
        .sort_values("prediction_timestamp")
        .reset_index(drop=True)
    )

    # `residual = predicted - actual`, matching the client's computeMetrics.
    frame = pd.DataFrame(
        {
            TIMESTAMP_COLUMN: paired["prediction_timestamp"],
            "predicted": paired["predicted"].astype(float),
            "actual": paired["actual"].astype(float),
        }
    )
    frame["residual"] = frame["predicted"] - frame["actual"]

    target_key = inference_window_key(
        request.model_id,
        request.model_version_id,
        request.dt,
        request.hour,
        INFERENCE_TRUTH_FILENAME,
    )
    # OVERWRITE, always. A re-join is the normal case here, not a retry:
    # truth is incremental, so the same window is re-read as more lab
    # results land, and this object must carry the CURRENT set of pairs —
    # matching the row whose sums are rewritten in the same step.
    payload = _to_parquet_bytes(frame)
    store.put_object_bytes(
        target_key, payload, content_type="application/vnd.apache.parquet"
    )

    residual = frame["residual"]
    actual = frame["actual"]
    return {
        "object_key": target_key,
        # Of the BYTES just written, the same way prediction_log_service
        # computes its own — not a second round trip to read the object back.
        "checksum": sha256_hex(payload),
        "truth_rows": truth_rows,
        "prediction_rows": prediction_rows,
        "paired_rows": int(len(frame)),
        "n": int(len(frame)),
        "sum_se": float((residual**2).sum()),
        "sum_ae": float(residual.abs().sum()),
        "sum_signed": float(residual.sum()),
        "sum_actual": float(actual.sum()),
        "sum_actual_sq": float((actual**2).sum()),
    }


def series(store, request: InferenceWindowTruthSeriesRequest) -> dict[str, Any]:
    """The joined pairs behind a range of windows, for the Monitoring tab.

    Reads the EXPLICIT keys the caller supplies rather than listing a
    prefix, because NestJS already holds every one of them in
    `InferenceWindowTruth.pairsKey` — see the request model's own doc
    comment for why this differs from `prediction_log_service.series`.

    A key that no longer resolves is SKIPPED, not fatal: a window whose
    object has been reclaimed is a gap in the chart, not a broken endpoint,
    and the same range read must keep working for every window beside it.
    """
    frames: list[pd.DataFrame] = []
    for key in request.keys:
        try:
            frame = store.get_frame(key)
        except Exception:
            continue
        if frame is None or len(frame) == 0:
            continue
        expected = {TIMESTAMP_COLUMN, "predicted", "actual", "residual"}
        if not expected.issubset(set(frame.columns)):
            continue
        frames.append(frame[[TIMESTAMP_COLUMN, "predicted", "actual", "residual"]])

    if not frames:
        return {"points": [], "truncated": False}

    merged = pd.concat(frames, ignore_index=True)
    merged[TIMESTAMP_COLUMN] = pd.to_datetime(merged[TIMESTAMP_COLUMN])
    merged = merged.sort_values(TIMESTAMP_COLUMN).reset_index(drop=True)

    truncated = len(merged) > request.limit
    if truncated:
        # Keep the MOST RECENT rows — a monitoring chart that silently
        # dropped the newest points would hide exactly the drift it exists
        # to show.
        merged = merged.iloc[-request.limit :].reset_index(drop=True)

    points = [
        {
            "timestamp": (
                ts.isoformat(sep=" ") if hasattr(ts, "isoformat") else str(ts)
            ),
            "predicted": float(predicted),
            "actual": float(actual_value),
            "residual": float(residual_value),
        }
        for ts, predicted, actual_value, residual_value in zip(
            merged[TIMESTAMP_COLUMN],
            merged["predicted"],
            merged["actual"],
            merged["residual"],
        )
    ]
    return {"points": points, "truncated": truncated}
