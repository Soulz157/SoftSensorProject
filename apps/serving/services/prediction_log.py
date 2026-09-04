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

import pandas as pd
import requests

from config import settings

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


def log_prediction(
    session: requests.Session,
    *,
    model_id: str,
    model_version_id: str,
    feature_columns: list[str],
    rows: list[dict[str, Any]],
    predictions: list[float],
    scaled: pd.DataFrame,
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

    body = {
        "modelId": model_id,
        "modelVersionId": model_version_id,
        "requestedAt": requested_at,
        "rowCount": row_count,
        "loggedRows": logged_rows,
        "samplingRate": settings.SERVING_LOG_SAMPLE_RATE,
        "rows": [
            {
                "features": {c: float(rows[i][c]) for c in feature_columns},
                "prediction": predictions[i],
            }
            for i in range(logged_rows)
        ],
        "featureStats": feature_stats,
        "predictionStats": prediction_stats,
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
