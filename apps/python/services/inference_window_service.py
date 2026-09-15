"""MODEL-SERVE-006. Materialize ONE scheduled inference window: fetch,
apply the pinned recipe's features, trim to the window's own boundaries,
and drop (never impute) any row with a Bad feature cell.

Division of labour restated from `artifact_service.py`'s own header,
because it applies identically here: NestJS owns the schedule, the window
row, and its idempotency key; this module owns the data and holds the only
source credentials in the call.

Deliberately NOT `artifact_service.materialize`: that function commits an
immutable, versioned dataset artifact under `drafts/`/`datasets/` — this
one writes a disposable, overwrite-on-retry scoring input under
`inference/`, and it applies a PINNED recipe (`feature_spec.json`'s
`features`) rather than accepting a fresh one from the caller, mirroring
`replay_holdout_for_run`'s relationship to `replay_holdout` one entity
over.

decisions.batch_input_is_pre_scale (pipelines/batch.py) applies here
identically: this module never calls `to_model_ready` to produce the frame
it WRITES — that frame carries feature columns in RAW engineering units,
plus their `__status` sidecars (required by `assert_frame_shape`, and
re-derived to all-Good by the container's own `to_model_ready` regardless).
The container applies the fitted transform, exactly as MODEL-SERVE-002's
synchronous /predict and MODEL-SERVE-003's batch input already do, so the
three paths cannot disagree about what scaling means.

MODEL-SERVE-001-T17 amendment, narrated rather than silent: this module now
ALSO computes drift aggregates (`_scaled_feature_stats`) and PSI histograms
(`_psi_histograms`) from this same cleaned frame before it is written. The
boundary above is unchanged — `to_model_ready` is called on a THROWAWAY
SCALED COPY, purely to derive sufficient statistics in the same units
`column_stats.json` was built in, never to alter what gets persisted to
`inference/`. See both helpers' own doc comments for why this does not
reopen the "three paths must agree" question the paragraph above raises.
"""

from __future__ import annotations

import asyncio
from collections.abc import Mapping
from typing import Any

import pandas as pd

from intergrations.object_store import (
    INFERENCE_INPUT_FILENAME,
    TIMESTAMP_COLUMN,
    inference_window_key,
)
from intergrations.object_store import missing_pct as _missing_pct
from schemas.preprocess import FeatureConfigRequest, InferenceWindowMaterializeRequest
from services.boxplot_service import good_values
from services.data_service import parse_interval
from services.data_source_service import PIDataSourceService, SQLDataSourceService
from services.feature_service import (
    apply_features,
    drop_bad_feature_rows,
    select_columns,
)
from services.feature_spec_service import max_replay_lookback
from services.frame_service import (
    diagnose_empty_pi_fetch,
    from_pi_response,
    from_sql_response,
    utc_to_wall_clock,
)
from softsensor_scaling import (
    DEFAULT_SCALER,
    assert_scaling_coverage,
    bucket_histogram,
    to_model_ready,
)

_pi = PIDataSourceService()
_sql = SQLDataSourceService()

# Same format `data_service._fmt_pi_time` uses, and the shape
# `PIFetchRequest.start_time`/`end_time`'s own examples already show — a
# naive absolute string every downstream parser here (`parse_timestamp`,
# `pd.to_datetime`) already accepts.
_TIME_FMT = "%Y-%m-%d %H:%M:%S.%f"


def _as_mapping(response: Any) -> dict[str, Any]:
    """Pydantic response -> plain dict for `frame_service`. Same one-line
    adapter `artifact_service._as_mapping` defines — kept local rather than
    imported, since importing an underscore-prefixed name across modules
    would read as reaching into that module's internals for something this
    small and stateless."""
    return response.model_dump() if hasattr(response, "model_dump") else dict(response)


def _psi_histograms(
    frame: pd.DataFrame, feature_columns: list[str], spec: Mapping[str, Any]
) -> dict[str, dict[str, Any]] | None:
    """MODEL-SERVE-001-T17. Bucket this window's own cleaned, RAW frame
    against each tag's frozen `feature_spec.json` PSI reference
    (`psiRefEdges`/`psiBinCount`/`psiBinMode`) — the window-plane
    counterpart of `apps/serving`'s `prediction_log.bucket_histograms`,
    delegating to the SAME shared primitive (`softsensor_scaling.
    bucket_histogram`) so a value bins identically whether it arrived via a
    live `/predict` request or a scheduled window.

    Called AFTER `drop_bad_feature_rows`, so every kept cell is already
    Good — `good_values` (the same Good-cell filter `compute_psi_ref_edges`
    itself uses to FIT the reference) is used anyway, for identical
    selection semantics on both sides of the comparison rather than a
    second, merely-equivalent filter.

    A tag missing ANY of the three spec fields is SKIPPED, never given a
    fabricated all-zero histogram — same discipline `prediction-log.
    authorized.service.ts`'s `resolvePsiReference` applies one layer up.
    Returns `None` (not `{}`) when nothing was bucketable at all, so the
    caller can tell "computed, no tag had a reference" from "present but
    empty" — the convention `apps/serving`'s own `bucket_histograms`
    already sets.
    """
    edges_by_tag = spec.get("psiRefEdges") or {}
    bin_count_by_tag = spec.get("psiBinCount") or {}
    bin_mode_by_tag = spec.get("psiBinMode") or {}

    result: dict[str, dict[str, Any]] = {}
    for column in feature_columns:
        edges = edges_by_tag.get(column)
        bin_mode = bin_mode_by_tag.get(column)
        if not edges or bin_count_by_tag.get(column) is None or bin_mode is None:
            continue
        result[column] = bucket_histogram(good_values(frame, column), edges, bin_mode)

    return result or None


def _column_aggregate(values: pd.Series) -> dict[str, float]:
    """`{n, sum, sumsq, min, max}` — same shape and same `n=0` zero-fill
    convention as `apps/serving`'s own `prediction_log._column_aggregate`,
    duplicated rather than cross-imported: apps/python and apps/serving are
    separate deployables, the same reasoning this module's own `_as_mapping`
    already gives for its local copy of that adapter."""
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


def _scaled_feature_stats(
    frame: pd.DataFrame, feature_columns: list[str], spec: Mapping[str, Any]
) -> dict[str, dict[str, float]] | None:
    """MODEL-SERVE-001-T17. Sufficient statistics per feature column, in
    MODEL-READY (scaled) units — the window-plane counterpart of
    `PredictionLog.featureStats`, so the drift z-score's baseline
    (`column_stats.json`, itself built over the SCALED GOLD frame) is
    compared against a live population in the same units. `None` (not
    `{}`) exactly when NO tag was coverable — same "absent means nothing
    computed" convention `_psi_histograms` sets; an all-`n:0` result for a
    covered-but-empty frame (a SKIPPED window) is a different, legitimate
    state and stays a real dict.

    Amends this module's own header claim ("never calls `to_model_ready`
    [to produce the frame it writes]"): what runs here is a THROWAWAY
    scaled COPY, computed only to derive these aggregates, via the SAME
    shared `to_model_ready` and the SAME persisted `scalingParams` every
    other path in this system scales with — never a fourth
    reimplementation that could silently disagree. Nothing here is
    written to object storage.

    `fitted_params` (`spec["scalingParams"]`) is load-bearing, not
    optional: without it `to_model_ready` would FIT on this window's own
    18-60 rows instead of applying what the model actually trained on —
    the exact silently-wrong transform DS-LAKE-018-T02 exists to prevent,
    one layer over.

    A tag whose scaler is not `"none"` but has NO `scalingParams` entry is
    EXCLUDED from the result, never scaled with re-fit params. This is a
    real, expected state — `to_model_ready`'s own docstring: a `"none"`-
    scaled tag and a zero-finite-value `"robust"` tag are both legitimately
    absent from `scalingParams` — not a corrupt spec. The exclusion is
    verified via `assert_scaling_coverage` against exactly the tag set
    about to be scaled (never the full `feature_columns` list — one
    uncovered tag must not fail the whole window), so a bug in this
    partition itself raises loudly rather than silently re-fitting.
    """
    scalers = {entry["tag"]: entry["method"] for entry in (spec.get("scaling") or [])}
    fitted_params = spec.get("scalingParams") or {}

    covered = [
        tag
        for tag in feature_columns
        if scalers.get(tag, DEFAULT_SCALER) == "none" or tag in fitted_params
    ]
    assert_scaling_coverage(covered, scalers, fitted_params)

    scaled, _used_params = to_model_ready(frame, covered, scalers, fitted_params)
    return {
        column: _column_aggregate(scaled[column]) for column in covered
    } or None


def materialize_window(
    store, request: InferenceWindowMaterializeRequest
) -> dict[str, Any]:
    """MODEL-SERVE-006-T04/T05/T06. Returns
    `{object_key, row_count, scored_rows, missing_pct, checksum}` —
    `InferenceWindowMaterializeResponse`'s own field set.

    `row_count` counts rows inside [window_start, window_end) BEFORE
    dropping any Bad-feature row; `scored_rows` counts what is actually
    written. The gap between them, divided by `row_count`, is
    `missing_pct` — the same relationship MODEL-FLOW-010-T06's holdout
    `missingPct` already has to its own row counts.
    """
    spec = store.get_json(request.feature_spec_key)
    step_configs = [
        FeatureConfigRequest(
            id=entry.get("name") or f"f{i}",
            name=entry.get("name"),
            **entry.get("config", {}),
        ).to_step()
        for i, entry in enumerate(spec.get("features", []))
    ]

    # T04: the recipe's own compound lookback, in ROWS (packages/py-scaling
    # softsensor_scaling.features.max_replay_lookback) — converted to a
    # fetch DURATION by `request.interval`, the one cadence value recorded
    # anywhere in this system that can do that conversion (see
    # InferenceWindowMaterializeRequest's own doc comment).
    required_rows = max_replay_lookback(step_configs)
    interval_td = parse_interval(request.interval)

    # T04's own finding, restated: PI tags do not arrive together, so a
    # window ending at now() is structurally complete and factually empty
    # in places. window_start/window_end already have the schedule's
    # configured lag baked in by the caller (the tick computes
    # windowEnd = now() - lag before this endpoint is ever called) — this
    # function only widens the FETCH for lookback, never applies a lag of
    # its own.
    window_start_wall = utc_to_wall_clock(request.window_start)
    window_end_wall = utc_to_wall_clock(request.window_end)
    fetch_start_wall = window_start_wall - required_rows * interval_td

    pi_payload: Mapping[str, Any] | None = None
    if request.pi is not None:
        widened = request.pi.model_copy(
            update={
                "start_time": fetch_start_wall.strftime(_TIME_FMT),
                "end_time": window_end_wall.strftime(_TIME_FMT),
            }
        )
        # `_pi.fetch` is a coroutine; this module runs inside a worker
        # thread with no event loop of its own — same reasoning
        # `artifact_service.materialize` states on its own identical call.
        response = asyncio.run(
            _pi.fetch(widened, interval=widened.summary_duration or request.interval)
        )
        # Kept as a mapping rather than passed straight through: the per-tag
        # status/error this payload carries is the ONLY record of whether an
        # empty result means "no samples" or "never reached the historian",
        # and building the frame discards it.
        pi_payload = _as_mapping(response)
        frame = from_pi_response(pi_payload)
    else:
        sql_spec = request.sql
        assert sql_spec is not None  # guaranteed by the request's own validator
        widened_query = sql_spec.query.model_copy(
            update={
                "start_time": fetch_start_wall.strftime(_TIME_FMT),
                "end_time": window_end_wall.strftime(_TIME_FMT),
            }
        )
        frame = from_sql_response(
            _as_mapping(_sql.query(widened_query)),
            timestamp_column=sql_spec.timestamp_column,
            tags=sql_spec.tags,
        )

    if len(frame) == 0:
        # Two different failures used to share one sentence, and the sentence
        # described only one of them. A fetch that never reached the
        # historian is not a tag-selection problem, and telling an operator
        # to "check the fetch config" while DNS is failing costs them the
        # afternoon. The source's own error wins whenever it reported one.
        diagnosis = (
            diagnose_empty_pi_fetch(pi_payload) if pi_payload is not None else None
        )
        if diagnosis:
            raise ValueError(
                "Could not read the source for this window's fetch range "
                f"[{fetch_start_wall}, {window_end_wall}): {diagnosis}"
            )
        raise ValueError(
            "The source returned no rows for this window's fetch range "
            f"[{fetch_start_wall}, {window_end_wall}) — the source answered "
            "but had no data in that range. Check the tag selection and "
            "whether the historian actually holds data this far back."
        )

    # Feature computation runs on the WIDENED frame (lookback padding
    # included), same order replay_holdout itself uses — a later config
    # may read an earlier config's own derived column, and lag/rolling need
    # the padding rows to compute correctly for rows near window_start.
    frame = apply_features(frame, step_configs)

    # Trim AFTER feature computation — the padding rows were scaffolding
    # for lag/rolling, never rows to score (replay_holdout's own phrasing).
    frame = frame[
        (frame[TIMESTAMP_COLUMN] >= window_start_wall)
        & (frame[TIMESTAMP_COLUMN] < window_end_wall)
    ].reset_index(drop=True)

    if len(frame) == 0:
        raise ValueError(
            "The fetch returned rows, but none fell inside this window's "
            f"own boundaries [{window_start_wall}, {window_end_wall}) — "
            "the fetch config's tag/time range likely does not cover it."
        )

    # Narrow to exactly the model's own feature columns (+ their status
    # sidecars, kept — assert_frame_shape requires every tag to carry one,
    # and to_model_ready's own doc comment states it re-derives them to
    # all-Good regardless, so keeping them costs nothing and loses nothing).
    frame = select_columns(frame, request.feature_columns)

    row_count = len(frame)
    rate = _missing_pct(frame)

    # T05: NEVER IMPUTED. A row carrying any Bad kept-feature cell is
    # dropped entirely, not filled — the same rule and the same reason
    # MODEL-FLOW-010-T06's holdout missingPct states on itself, and the
    # exact trap to_model_ready's own docstring names: scaling silently
    # launders a Bad cell holding a real number to Good, with the evidence
    # gone afterward. This MUST run before any scaling — the container
    # still owns the transform that scores this frame; this module's own
    # `to_model_ready` calls below (module docstring's T17 amendment) are a
    # throwaway copy for drift aggregates only, and both run AFTER this
    # line for the identical reason.
    frame, _dropped = drop_bad_feature_rows(frame, request.feature_columns)
    scored_rows = len(frame)

    # MODEL-SERVE-001-T17. Both derived from this same cleaned, RAW frame —
    # `None`/`{}` are legitimate ("no reference" / "no covered tag"), never
    # an error, so a spec that predates T13 (no psiRefEdges) or a window
    # with zero scored rows still returns cleanly.
    feature_histograms = _psi_histograms(frame, request.feature_columns, spec)
    feature_stats = _scaled_feature_stats(frame, request.feature_columns, spec)

    # Filename-keyed, built HERE — never accepted from the caller. inference/
    # has exactly one writer and one key-builder (this module), the same
    # arrangement object_store.SERVING_LOG_ROOT already documents for
    # itself; a target_key field on the request would be a second builder
    # for a root only this side is meant to own.
    target_key = inference_window_key(
        request.model_id,
        request.model_version_id,
        request.dt,
        request.hour,
        INFERENCE_INPUT_FILENAME,
    )
    stats = store.put_frame(frame, target_key, overwrite=request.overwrite)

    return {
        "object_key": stats.object_key,
        "row_count": row_count,
        "scored_rows": scored_rows,
        "missing_pct": rate,
        "checksum": stats.checksum,
        "feature_histograms": feature_histograms,
        "feature_stats": feature_stats,
    }
