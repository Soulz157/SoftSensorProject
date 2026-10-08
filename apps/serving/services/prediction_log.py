"""MODEL-SERVE-005-T01. Decide whether to log a /predict request, compute
its model-ready aggregates locally (this process holds no Postgres/MinIO
credentials — see config/env.py), and POST them plus a capped raw-row
sample to the backend's serving-token ingest endpoint.

Scheduled via FastAPI `BackgroundTasks` from routers/serve.py, never
awaited inline — a slow or failed log call must never delay or fail the
/predict response it describes. This module is structurally incapable of
raising past its own boundary: every external call is wrapped, and a
failure only ever reaches `logger.warning`.
"""

from __future__ import annotations

import logging
import random
from datetime import datetime, timezone
from typing import Any

import numpy as np
import pandas as pd
import requests

from config import settings
from softsensor_scaling import bucket_histogram as _bucket_histogram

logger = logging.getLogger("serving.prediction_log")

_INGEST_PATH = "/api/v1/authorized/serving/predictions"


def should_log() -> bool:
    """A coin flip per REQUEST, not per row within one request — see
    SERVING_LOG_SAMPLE_RATE's own doc comment in config/env.py."""
    rate = settings.SERVING_LOG_SAMPLE_RATE
    if rate <= 0:
        return False
    if rate >= 1:
        return True
    return random.random() < rate


def _column_aggregate(values: pd.Series) -> dict[str, float]:
    """`{n, sum, sumsq, min, max}` — sufficient statistics for an exact
    pooled mean/variance later (apps/backend's `poolFeatureStats`), without
    ever needing these raw values again."""
    arr = values.to_numpy(dtype=float)
    if arr.size == 0:
        return {"n": 0, "sum": 0.0, "sumsq": 0.0, "min": 0.0, "max": 0.0}
    return {
        "n": int(arr.size),
        "sum": float(arr.sum()),
        "sumsq": float((arr * arr).sum()),
        "min": float(arr.min()),
        "max": float(arr.max()),
    }


def bucket_histograms(
    rows: list[dict[str, Any]],
    feature_columns: list[str],
    psi_ref_edges: dict[str, list[float]] | None,
    psi_bin_count: dict[str, int] | None,
    psi_bin_mode: dict[str, str] | None,
) -> dict[str, dict[str, Any]] | None:
    """MODEL-SERVE-001-T13. Bucket the FULL raw `rows` population (same
    population `_column_aggregate` covers for `featureStats` above — never
    the `SERVING_LOG_MAX_ROWS`-capped detail sample `logged_rows` limits)
    against each tag's FROZEN reference edges, at WRITE time — never at
    read time, which is what lets `poolHistograms` (apps/backend) pool many
    requests by plain elementwise addition without re-opening raw-row
    Parquet, and what keeps a live window from re-binning against its own
    values (the contamination DS-LAKE-005B-A-V06's shared-bucket-basis rule
    exists to prevent for the scrubber).

    Delegates the actual bucketing to `softsensor_scaling.psi.
    bucket_histogram` — SHARED with `apps/python`'s training-time reference
    fit (`feature_spec_service.compute_psi_ref_edges`), so a value is
    binned the identical way whether it is being counted into the
    reference or into a live request.

    `edges`/`bin_count`/`bin_mode` are `feature_spec.json`'s own frozen
    `psiRefEdges`/`psiBinCount`/`psiBinMode` for one tag, read off the
    serving descriptor — never re-derived here. A tag absent from any of
    the three has no frozen reference — SKIPPED entirely, never a
    fabricated all-zero histogram. Returns `None` (not `{}`) when nothing
    was bucketable at all, so the caller can distinguish "computed, no tag
    had a reference" from a present-but-empty object.
    """
    edges_by_tag = psi_ref_edges or {}
    bin_count_by_tag = psi_bin_count or {}
    bin_mode_by_tag = psi_bin_mode or {}

    result: dict[str, dict[str, Any]] = {}
    for column in feature_columns:
        edges = edges_by_tag.get(column)
        bin_count = bin_count_by_tag.get(column)
        bin_mode = bin_mode_by_tag.get(column)
        if not edges or bin_count is None or bin_mode is None:
            continue

        values = np.array(
            [row[column] for row in rows if row.get(column) is not None],
            dtype=float,
        )
        result[column] = _bucket_histogram(values, edges, bin_mode)

    return result or None


def log_prediction(
    session: requests.Session,
    *,
    model_id: str,
    model_version_id: str,
    feature_columns: list[str],
    rows: list[dict[str, Any]],
    predictions: list[float],
    scaled: pd.DataFrame,
    psi_ref_edges: dict[str, list[float]] | None = None,
    psi_bin_count: dict[str, int] | None = None,
    psi_bin_mode: dict[str, str] | None = None,
) -> None:
    """Fire-and-forget: builds the ingest body and POSTs it. Called from a
    FastAPI BackgroundTask, i.e. AFTER the /predict response has already
    been sent — nothing here can affect it.

    `feature_columns` restricts what gets logged from `rows` to exactly the
    validated model inputs — a caller-supplied row dict can carry extra
    keys `_validate_rows` never checked (it only requires the named
    columns to be present and numeric), and logging them verbatim would
    write untyped, unvalidated data into the Parquet object.
    """
    if not rows:
        return

    # MODEL-SERVE-005-T01, live-verified bug fix: `datetime.isoformat()`
    # emits a `+00:00` offset, which the backend's `z.string().datetime()`
    # (no `{offset: true}`) rejects with a 400 — that failure was being
    # swallowed by this function's own "never fail the caller" try/except,
    # so every logged request was silently dropped before this fix. `Z` is
    # the format `new Date().toISOString()` already produces everywhere
    # else this system sends a timestamp (the client hooks, the backend
    # itself); matching it here means one datetime convention, not two.
    requested_at = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    row_count = len(rows)
    cap = max(0, settings.SERVING_LOG_MAX_ROWS)
    logged_rows = min(row_count, cap)

    feature_stats = {
        column: _column_aggregate(scaled[column]) for column in scaled.columns
    }
    prediction_stats = _column_aggregate(pd.Series(predictions, dtype=float))
    # MODEL-SERVE-001-T13. Over the FULL `rows` (same population as
    # `feature_stats` above), RAW — never `scaled`, same reasoning as the
    # `"rows"` list below: PSI's bin edges are frozen in engineering units.
    feature_histograms = bucket_histograms(
        rows, feature_columns, psi_ref_edges, psi_bin_count, psi_bin_mode
    )

    body = {
        "modelId": model_id,
        "modelVersionId": model_version_id,
        "requestedAt": requested_at,
        "rowCount": row_count,
        "loggedRows": logged_rows,
        "samplingRate": settings.SERVING_LOG_SAMPLE_RATE,
        # MODEL-SERVE-001-T12. `features` comes from `rows` — the caller's
        # RAW request, in engineering units — never `scaled`. `scaled` feeds
        # ONLY `featureStats` below; the client's Input Data tab previously
        # `inverseScale()`d these values as though they were a scaled
        # artifact column, corrupting every displayed reading by the
        # scaler's own span. There is nothing to invert here.
        "rows": [
            {
                "features": {c: float(rows[i][c]) for c in feature_columns},
                "prediction": predictions[i],
            }
            for i in range(logged_rows)
        ],
        "featureStats": feature_stats,
        "predictionStats": prediction_stats,
        "featureHistograms": feature_histograms,
    }

    try:
        resp = session.post(
            f"{settings.BACKEND_API_BASE.rstrip('/')}{_INGEST_PATH}",
            json=body,
            timeout=settings.SERVING_LOG_TIMEOUT_SECONDS,
        )
        if resp.status_code >= 400:
            logger.warning(
                "prediction-log ingest failed model=%s version=%s status=%s body=%s",
                model_id,
                model_version_id,
                resp.status_code,
                resp.text[:200],
            )
    except requests.RequestException as exc:
        logger.warning(
            "prediction-log ingest request failed model=%s version=%s: %s",
            model_id,
            model_version_id,
            exc,
        )
