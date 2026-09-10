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
identically: this module never calls `to_model_ready` — the frame it
writes carries feature columns in RAW engineering units, plus their
`__status` sidecars (required by `assert_frame_shape`, and re-derived to
all-Good by the container's own `to_model_ready` regardless). The
container applies the fitted transform, exactly as MODEL-SERVE-002's
synchronous /predict and MODEL-SERVE-003's batch input already do, so the
three paths cannot disagree about what scaling means.
"""

from __future__ import annotations

import asyncio
from typing import Any

from intergrations.object_store import (
    INFERENCE_INPUT_FILENAME,
    TIMESTAMP_COLUMN,
    inference_window_key,
)
from intergrations.object_store import missing_pct as _missing_pct
from schemas.preprocess import FeatureConfigRequest, InferenceWindowMaterializeRequest
from services.data_service import parse_interval
from services.data_source_service import PIDataSourceService, SQLDataSourceService
from services.feature_service import (
    apply_features,
    drop_bad_feature_rows,
    select_columns,
)
from services.feature_spec_service import max_replay_lookback
from services.frame_service import (
    from_pi_response,
    from_sql_response,
    utc_to_wall_clock,
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
        frame = from_pi_response(_as_mapping(response))
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
        raise ValueError(
            "The source returned no rows for this window's fetch range "
            f"[{fetch_start_wall}, {window_end_wall}) — check the "
            "schedule's fetch config and tag selection."
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
    # gone afterward. This MUST run before any scaling, which is why this
    # module never calls to_model_ready at all — that call belongs to the
    # container, on a frame this function has already cleaned.
    frame, _dropped = drop_bad_feature_rows(frame, request.feature_columns)
    scored_rows = len(frame)

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
    }
