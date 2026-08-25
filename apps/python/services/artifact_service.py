"""Artifact lifecycle: materialize V1, clean one step, page rows, clear tmp.

These are the four calls the NestJS job runner makes. Everything here is
synchronous and CPU- or I/O-bound; the router runs it via `asyncio.to_thread`
so a large frame never occupies the event loop.

Division of labour, restated because it is easy to erode:

* NestJS owns authorization, dataset ownership, version numbering and job state.
* This service owns the data and holds the only S3 credentials in the system.

That last point is why `cleanup` exists at all — NestJS cannot delete its own
tmp objects.
"""

from __future__ import annotations
from datetime import datetime, timedelta, timezone

import asyncio
import time
from typing import Any

import pandas as pd
import pyarrow as pa
from fastapi import Response

from intergrations.object_store import (
    COLUMN_STATS_FILENAME,
    FEATURE_SPEC_FILENAME,
    MANIFEST_FILENAME,
    TIMESTAMP_COLUMN,
    VALIDATE_DATA_FILENAME,
    VALIDATION_REPORT_FILENAME,
    ArtifactStats,
    ObjectStore,
    ObjectStoreError,
    build_manifest,
    sidecar_key,
    status_column,
    tag_columns,
    METRICS_FILENAME,
    MODEL_FILENAME,
    PREDICTIONS_FILENAME,
    RUN_MANIFEST_FILENAME,
    draft_run_key,
    is_committed_artifact_key,
    is_draft_run_key,
    is_model_run_key,
    missing_pct,
    model_run_key,
    split_data_key,
)
from schemas.preprocess import (
    ArtifactReclaimRequest,
    CleanRequest,
    CleanupRequest,
    ColumnStatsRequest,
    FeatureConfigRequest,
    FeaturesRequest,
    HoldoutSplitRequest,
    MaterializeRequest,
    MAX_PREDICTION_POINTS,
    MetadataRequest,
    ReplayHoldoutForRunRequest,
    ReplayHoldoutRequest,
    ResplitHoldoutRequest,
    RowsRequest,
    TagCatalogRequest,
    ValidateRequest,
)
from services.cleaning_service import apply_operations
from services.column_stats_service import build_column_stats
from services.data_source_service import PIDataSourceService, SQLDataSourceService
from services.feature_service import (
    apply_features,
    feature_column_name,
    force_keep_target,
    select_columns,
    to_model_ready,
)
from services.feature_spec_service import build_feature_spec, max_replay_lookback
from services.frame_service import from_pi_response, from_sql_response
from services.preview_service import _finite, sample_rows
from services.validation_service import run_validation

_pi = PIDataSourceService()
_sql = SQLDataSourceService()

_ALLOWED_RUN_UPLOADS = frozenset(
    {MODEL_FILENAME, METRICS_FILENAME, RUN_MANIFEST_FILENAME, PREDICTIONS_FILENAME}
)


def _stats_payload(
    stats: ArtifactStats,
    started: float,
    column_stats_key: str | None = None,
    feature_spec_key: str | None = None,
    skipped_features: list[str] | None = None,
    validation_row_count: int | None = None,
    validation_holdout_from: str | None = None,
    validation_missing_pct: float | None = None,
) -> dict[str, Any]:
    return {
        "object_key": stats.object_key,
        "row_count": stats.row_count,
        "column_count": stats.column_count,
        "size_bytes": stats.size_bytes,
        "missing_pct": stats.missing_pct,
        "checksum": stats.checksum,
        "duration_ms": int((time.perf_counter() - started) * 1000),
        "column_stats_key": column_stats_key,
        "feature_spec_key": feature_spec_key,
        # Names of feature columns `apply_features` skipped due to a name
        # collision with an already-existing column (see `apply_features`'s
        # own docstring) — always [] for materialize/clean, which never
        # call apply_features at all. Only `features()` ever populates
        # this; every other caller passes nothing, defaulting it to [].
        "skipped_features": skipped_features or [],
        # DS-LAKE-018-T03. Rows written to validate_data.parquet (holdout
        # window + lead-in) — None means no holdout was requested; only
        # `materialize()` ever sets this. `row_count` above keeps meaning
        # "rows in data.parquet" unconditionally, per the task's own AC.
        "validation_row_count": validation_row_count,
        # DS-LAKE-018-T05. The resolved holdout boundary, same string
        # convention `replay_holdout`'s own `holdout_from` expects.
        "validation_holdout_from": validation_holdout_from,
        # MODEL-FLOW-010-T06. Share of `validate_data.parquet` cells that are
        # not Good — `missing_pct(validate_frame)`, computed while the frame
        # is already in memory at write time rather than a compute-on-read
        # scan later. None exactly when `validation_row_count` is None (no
        # holdout requested / not yet re-captured for a legacy holdout).
        "validation_missing_pct": validation_missing_pct,
    }


def _commit(
    store: ObjectStore,
    stats: ArtifactStats,
    started: float,
    *,
    parent_key: str | None = None,
    operations: Any = None,
    column_stats: dict[str, Any] | None = None,
    feature_spec: dict[str, Any] | None = None,
    skipped_features: list[str] | None = None,
    validation_row_count: int | None = None,
    validation_holdout_from: str | None = None,
    validation_missing_pct: float | None = None,
) -> dict[str, Any]:
    """Write the manifest (and, since DS-LAKE-005B-A-T07, the column-stats
    sidecar; since DS-LAKE-006-T05, the feature-spec sidecar) beside the
    data, then return the response payload.

    Every sidecar is written AFTER the data, and none of their failures
    unwind the data object — the data is the expensive thing to reproduce
    and a sidecar can be rebuilt from the object plus its row, while the
    reverse ordering would let a sidecar describe an artifact that does not
    exist.

    `column_stats`/`feature_spec` are plain dicts (not DataFrames) — the
    caller (`materialize`/`clean`/`features`) computes them from frames it
    already holds in memory; `_commit` never reads a frame itself, so it can
    never become a second place that opens `data.parquet` at write time.
    """
    payload = _stats_payload(
        stats,
        started,
        column_stats_key=(
            sidecar_key(stats.object_key, COLUMN_STATS_FILENAME)
            if column_stats is not None
            else None
        ),
        feature_spec_key=(
            sidecar_key(stats.object_key, FEATURE_SPEC_FILENAME)
            if feature_spec is not None
            else None
        ),
        skipped_features=skipped_features,
        validation_row_count=validation_row_count,
        validation_holdout_from=validation_holdout_from,
        validation_missing_pct=validation_missing_pct,
    )
    store.put_json(
        sidecar_key(stats.object_key, MANIFEST_FILENAME),
        build_manifest(
            stats,
            parent_key=parent_key,
            operations=operations,
            duration_ms=payload["duration_ms"],
        ),
    )
    if column_stats is not None:
        store.put_json(
            sidecar_key(stats.object_key, COLUMN_STATS_FILENAME), column_stats
        )
    if feature_spec is not None:
        store.put_json(
            sidecar_key(stats.object_key, FEATURE_SPEC_FILENAME), feature_spec
        )
    return payload


def assert_frame_is_usable(frame: pd.DataFrame) -> None:
    """Reject an empty fetch loudly, before anything is written.

    A zero-row frame is a legal Parquet file, so without this the job succeeds,
    a DatasetVersion row is committed with rowCount 0, and the user is shown an
    empty dataset with no error to explain it.
    """
    if len(frame) == 0:
        raise ValueError(
            "The source returned no rows for the requested range. Nothing was "
            "written — check the time range and the tag selection."
        )
    if not tag_columns(frame):
        raise ValueError(
            "The source returned rows but no tag columns besides "
            f"{TIMESTAMP_COLUMN!r}."
        )


def _as_mapping(response: Any) -> dict[str, Any]:
    """Pydantic response -> plain dict for `frame_service`."""
    return response.model_dump() if hasattr(response, "model_dump") else dict(response)


# DS-LAKE-018-T02/T03: over-provisioned lead-in duration, mirrored from
# `HOLDOUT_LEAD_IN_DURATION` in apps/client/lib/holdout.ts ({value:7,
# unit:'day'}). Applied HERE rather than client-side — userDecisions[0]:
# "the interval is already known at materialize time... so the duration
# converts to rows there." A plain constant, not a config value: no env var
# exists for this on either side (see the TS constant's own doc comment).
HOLDOUT_LEAD_IN = timedelta(days=7)


def _split_holdout(
    frame: pd.DataFrame, holdout: HoldoutSplitRequest
) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Split one materialized frame into (train, validate) at BRONZE.

    `train` keeps every row OUTSIDE the holdout window — this is what lands
    in `data.parquet`, so the holdout genuinely leaves the training path
    (finding: "HOLDOUT ROWS MUST BE CUT FROM data.parquet TOO", the easiest
    thing here to get wrong and the hardest to notice). `validate` is the
    holdout window PLUS a lead-in margin ahead of it, so DS-LAKE-018-T04's
    replay has real prior rows to compute lag/rolling features for the
    holdout's own first rows (finding: "LAG AND ROLLING FEATURES NEED
    LEAD-IN ROWS"). Lead-in rows are NOT removed from train — they were
    already inside the fetch window and cost nothing extra to carry
    (userDecisions[0]) — they are only ADDITIONALLY copied into `validate`.

    Timestamps compare directly: both sides are the same "local wall-clock"
    convention already used everywhere in this wizard (`HoldoutSplitRequest`'s
    own doc comment) — no second timezone conversion here.
    """
    ts = frame[TIMESTAMP_COLUMN]
    holdout_from = pd.Timestamp(holdout.from_time)
    holdout_to = pd.Timestamp(holdout.to_time)
    lead_in_from = holdout_from - HOLDOUT_LEAD_IN

    holdout_mask = (ts >= holdout_from) & (ts <= holdout_to)
    lead_in_mask = (ts >= lead_in_from) & (ts < holdout_from)

    train = frame[~holdout_mask].reset_index(drop=True)
    validate = (
        frame[lead_in_mask | holdout_mask]
        .sort_values(TIMESTAMP_COLUMN)
        .reset_index(drop=True)
    )
    return train, validate


def materialize(store: ObjectStore, request: MaterializeRequest) -> dict[str, Any]:
    """Fetch from the source, normalise, and write the raw artifact.

    The two source shapes are genuinely different and converge only here: PI is
    tag-major with no shared time axis, SQL is row-major and already aligned.
    `frame_service` reconciles them; this function only routes and writes.

    DS-LAKE-018-T03: when `request.holdout` is set, this is ONE operation
    with TWO outputs (scope_note — do not split into two calls): the holdout
    window is cut from the frame BEFORE it is written as `data.parquet`, and
    written SEPARATELY as `validate_data.parquet` beside it, with lead-in
    rows included. `row_count` in the response keeps meaning "rows in
    data.parquet" exactly as before; `validation_row_count` is the new,
    separate field for the sidecar's own row count.
    """
    started = time.perf_counter()

    if request.pi is not None:
        # `_pi.fetch` is a coroutine, and this module runs inside a worker
        # thread with no event loop of its own, so it is driven to completion
        # here. `asyncio.run` is safe precisely BECAUSE this is not the main
        # thread — calling it on the loop thread would raise.
        response = asyncio.run(
            _pi.fetch(request.pi, interval=request.pi.summary_duration or "1m")
        )
        frame = from_pi_response(_as_mapping(response))
    else:
        spec = request.sql
        assert spec is not None  # guaranteed by MaterializeRequest's validator
        frame = from_sql_response(
            _as_mapping(_sql.query(spec.query)),
            timestamp_column=spec.timestamp_column,
            tags=spec.tags,
        )

    assert_frame_is_usable(frame)

    validate_frame: pd.DataFrame | None = None
    if request.holdout is not None:
        frame, validate_frame = _split_holdout(frame, request.holdout)
        # Cutting the holdout can, in principle, leave nothing on either
        # side (e.g. the whole fetch window picked as the holdout — T01's
        # own guard 1 does not refuse that, only containment). Both must
        # fail loud here, not commit a 0-row artifact silently.
        assert_frame_is_usable(frame)
        if len(validate_frame) == 0:
            raise ValueError(
                "The holdout window matched no rows in the fetched data — "
                "check the holdout range against the fetch window."
            )

    stats = store.put_frame(frame, request.target_key,
                            overwrite=request.overwrite)
    # No parent: a materialised artifact is a lineage root — it comes from the
    # source system, not from another artifact. build_column_stats(parent_frame=
    # None) reports drift=None for every tag, not 0 — there is nothing to
    # compare against, which is a different fact than "no drift occurred".
    column_stats = build_column_stats(frame, operations=[])

    validation_row_count = None
    validation_holdout_from = None
    validation_missing_pct = None
    if validate_frame is not None:
        validate_key = sidecar_key(stats.object_key, VALIDATE_DATA_FILENAME)
        store.put_frame(validate_frame, validate_key, overwrite=request.overwrite)
        validation_row_count = len(validate_frame)
        # Canonicalised via `pd.Timestamp` (not the raw request string) so a
        # later replay compares against the SAME parsed form `_split_holdout`
        # itself compared against, never a second, independent parse.
        assert request.holdout is not None  # validate_frame implies this
        validation_holdout_from = str(pd.Timestamp(request.holdout.from_time))
        # MODEL-FLOW-010-T06: captured now, while validate_frame is already
        # in memory, instead of a compute-on-read scan against
        # validate_data.parquet later.
        validation_missing_pct = missing_pct(validate_frame)

    return _commit(
        store, stats, started,
        column_stats=column_stats,
        validation_row_count=validation_row_count,
        validation_holdout_from=validation_holdout_from,
        validation_missing_pct=validation_missing_pct,
    )


def resplit_holdout(
    store: ObjectStore, request: ResplitHoldoutRequest
) -> dict[str, Any]:
    """Re-split an EXISTING, PRISTINE (never-split) BRONZE against a new
    holdout window, without re-fetching from the source.

    Companion to `materialize()`'s own holdout branch, used when the user
    changes the holdout AFTER the artifact has already been materialized
    (DS-LAKE-018-T06: the holdout picker moved from Step 2 to Step 3.1,
    which mounts after the bronze warm has already run once with no
    holdout).

    `request.source_key` MUST be pristine — the caller (NestJS
    `resplitDraftHoldoutService`) resolves the draft's root BRONZE
    (`parentArtifactId: null`) and refuses one with a non-null
    `validationRowCount`, since re-splitting an ALREADY-split frame would
    permanently shed the rows the previous split cut into
    `validate_data.parquet` — there is no reconstruction step here on
    purpose (see this task's own decision note: the prior holdout boundary
    needed to reconstruct is not persisted anywhere reachable). Splitting
    fresh from the pristine source every time is what makes repeated
    holdout edits lossless and idempotent.

    Otherwise IDENTICAL to `materialize()`'s holdout branch — same
    `_split_holdout`, same guards, same `_commit` shape — reused verbatim
    rather than re-derived, so the lead-in math never drifts between the
    two call sites.
    """
    started = time.perf_counter()

    frame = store.get_frame(request.source_key)
    assert_frame_is_usable(frame)

    train, validate_frame = _split_holdout(frame, request.holdout)
    # Same as materialize()'s own guard: cutting the holdout can leave
    # nothing on either side, and both must fail loud here rather than
    # commit a 0-row artifact silently.
    assert_frame_is_usable(train)
    if len(validate_frame) == 0:
        raise ValueError(
            "The holdout window matched no rows in the source data — "
            "check the holdout range against the fetch window."
        )

    stats = store.put_frame(train, request.target_key, overwrite=request.overwrite)
    # No parent-frame comparison: mirrors materialize()'s own reasoning —
    # this is a fresh split of a pristine frame, so there is nothing else to
    # diff drift against.
    column_stats = build_column_stats(train, operations=[])

    validate_key = sidecar_key(stats.object_key, VALIDATE_DATA_FILENAME)
    store.put_frame(validate_frame, validate_key, overwrite=request.overwrite)

    # Canonicalised via `pd.Timestamp`, same as materialize() — so a later
    # replay compares against the SAME parsed form `_split_holdout` itself
    # compared against, never a second, independent parse.
    validation_holdout_from = str(pd.Timestamp(request.holdout.from_time))

    return _commit(
        store, stats, started,
        parent_key=request.source_key,
        column_stats=column_stats,
        validation_row_count=len(validate_frame),
        validation_holdout_from=validation_holdout_from,
        validation_missing_pct=missing_pct(validate_frame),
    )


def clean(store: ObjectStore, request: CleanRequest) -> dict[str, Any]:
    """Apply operations from `source_key` to `target_key`.

    Accepts a LIST even though the runner sends one operation at a time: a
    caller that does not need per-operation progress (a test, a future batch
    path) should not have to make N round trips to apply N operations.
    """
    started = time.perf_counter()

    source = store.get_frame(request.source_key)
    result = apply_operations(
        source,
        [operation.to_step() for operation in request.operations],
        request.precision,
    )
    # A pipeline that drops every row is a configuration mistake, not a
    # dataset. Catching it here means the job FAILS with a reason instead of
    # committing an empty version.
    assert_frame_is_usable(result)

    stats = store.put_frame(result, request.target_key,
                            overwrite=request.overwrite)
    # `source` (the PARENT) is already in memory from the get_frame above —
    # DS-LAKE-005B-A-T07's drift needs it, and this is the only place clean()
    # ever needs to hold both frames at once; _commit itself never reads one.
    column_stats = build_column_stats(
        result, request.operations, parent_frame=source
    )
    return _commit(
        store,
        stats,
        started,
        parent_key=request.source_key,
        operations=[operation.to_step() for operation in request.operations],
        column_stats=column_stats,
    )


def replay_holdout(store: ObjectStore, request: ReplayHoldoutRequest) -> dict[str, Any]:
    """DS-LAKE-018-T04. Raw holdout (`validate_data.parquet`) -> model-ready
    frame, scaler params SUPPLIED, never re-fit. RESOLVED (user decision):
    the holdout stays fully raw — no `apply_operations` call here at all,
    unlike `clean()`; only feature/select/scale run, the same tail
    `features()` runs.

    Order matters and mirrors `features()` deliberately: the lead-in
    sufficiency check runs BEFORE any transform, so a doomed replay fails
    fast rather than after paying for feature computation it can't trust.
    """
    started = time.perf_counter()

    source = store.get_frame(request.source_key)
    step_configs = [f.to_step() for f in request.features]

    # LEAD-IN CHECK IS A REFUSAL, NOT A WARNING (scope_note). Computed from
    # the recipe's own compound lookback (DS-LAKE-018-T04's
    # `max_replay_lookback` — a lag on a rolling column compounds), not
    # re-derived from a duration/interval a caller would have to look up.
    # The alternative is the silent failure this check exists to prevent:
    # the holdout's first rows get null/wrong lag values, feed straight
    # into predict(), and depress the metric with no trace of why.
    required = max_replay_lookback(step_configs)
    holdout_from = pd.Timestamp(request.holdout_from)
    captured = int((source[TIMESTAMP_COLUMN] < holdout_from).sum())
    if captured < required:
        raise ValueError(
            f"Lead-in is insufficient to replay this recipe: {captured} "
            f"row(s) captured before the holdout boundary, but the deepest "
            f"feature needs {required} (short by {required - captured}). "
            "Re-materialize with a wider fetch window or a later holdout "
            "start."
        )

    effective_selected = force_keep_target(
        request.selected_columns, request.target_y)

    skipped_columns: list[str] = []
    result = apply_features(source, step_configs, skipped=skipped_columns)
    result = select_columns(result, effective_selected)
    # `scaling_params` is what T02 recorded on the ORIGINAL GOLD's own
    # feature_spec.json — SUPPLIED here, never re-fit on the holdout's own
    # statistics (T02's own finding: that would be a silently DIFFERENT,
    # wrong transform).
    result, _ = to_model_ready(
        result, tag_columns(result), request.scalers,
        fitted_params=request.scaling_params,
    )

    # Trim lead-in rows AFTER feature computation, before returning — they
    # were scaffolding for lag/rolling, never rows to score (scope_note).
    result = result[result[TIMESTAMP_COLUMN] >= holdout_from].reset_index(
        drop=True)
    assert_frame_is_usable(result)

    stats = store.put_frame(
        result, request.target_key, overwrite=request.overwrite)
    return _commit(
        store, stats, started,
        parent_key=request.source_key,
        operations=step_configs,
    )


def replay_holdout_for_run(
    store: ObjectStore, request: ReplayHoldoutForRunRequest
) -> dict[str, Any]:
    """DS-LAKE-018-T05. `replay_holdout`, sourced from an EXISTING GOLD's own
    recorded `feature_spec.json` instead of the caller re-supplying the
    recipe by hand — this is the endpoint `claim()` (model-run.authorized.
    service.ts) calls, since NestJS never re-derives a training run's recipe
    itself; `feature_spec_key` is `ModelTrainingRun.featureSpecKey`, already
    pinned on the run row at training-create time.

    `feature_spec.json`'s own `features` entries are `{name, kind, config}`
    (`feature_spec_service.build_feature_spec` strips only `id`/`name` —
    `config` still carries `kind` redundantly alongside every other field)
    — reshaped back into `FeatureConfigRequest`'s flat shape here via
    `config` alone, which already has everything `FeatureConfigRequest`
    needs. `id` is a synthesised placeholder: `apply_features` never reads
    it (a client-side identity field only, confirmed against
    `feature_service.py`), so any value round-trips safely.
    """
    spec = store.get_json(request.feature_spec_key)

    target_y = spec.get("target_y")
    if spec.get("target_scaled"):
        # Mirrors train.py's own refusal (its `main()`, before the split):
        # no inverse transform is recorded for a scaled target, so a score
        # against it would be silently wrong. A run this applies to never
        # reaches model.fit/predict either — this is a defensive mirror of
        # that guard, not this run's only line of defense.
        raise ValueError(
            f"target_y '{target_y}' is scaled in this GOLD's "
            "feature_spec.json — refusing holdout replay (no inverse "
            "transform recorded)."
        )

    features_config = [
        FeatureConfigRequest(
            id=entry.get("name") or f"f{i}",
            name=entry.get("name"),
            **entry.get("config", {}),
        )
        for i, entry in enumerate(spec.get("features", []))
    ]
    scalers = {row["tag"]: row["method"] for row in spec.get("scaling", [])}

    return replay_holdout(
        store,
        ReplayHoldoutRequest(
            source_key=request.source_key,
            target_key=request.target_key,
            holdout_from=request.holdout_from,
            features=features_config,
            selected_columns=spec.get("selectedColumns"),
            scalers=scalers,
            scaling_params=spec.get("scalingParams") or {},
            target_y=target_y,
            overwrite=request.overwrite,
        ),
    )


def features(store: ObjectStore, request: FeaturesRequest) -> dict[str, Any]:
    """DS-LAKE-006-T05. `source_key` is the SILVER artifact; `target_key` is
    the GOLD artifact. `_commit`'s `parent_key=request.source_key` is what
    makes the GOLD write's manifest.json point at the silver artifact —
    the object-store-level counterpart to `DatasetArtifact.parentArtifactId`
    (a Postgres FK NestJS sets when it persists the row this endpoint's
    response feeds; this service never touches Postgres, same division of
    labour `materialize`/`clean` already keep — see module docstring).

    Order is fixed: applyFeatures -> selectColumns -> toModelReady, matching
    the client pipeline's own tail (`step-5-review-save.tsx`:
    `applyFeatures -> precleanse -> ... -> selectColumns -> toModelReady`) —
    cleaning already happened to produce the SILVER source, so only the
    feature/select/scale stages run here.
    """
    started = time.perf_counter()

    source = store.get_frame(request.source_key)
    step_configs = [f.to_step() for f in request.features]

    # Computed once and reused for both the actual column drop AND the spec
    # that describes it — request.selected_columns alone would let the spec
    # claim a different column set than what select_columns actually kept,
    # and since selectedColumns is part of the featureHash payload, that
    # would make the hash describe bytes that don't exist.
    effective_selected = force_keep_target(
        request.selected_columns, request.target_y)

    skipped_columns: list[str] = []
    result = apply_features(source, step_configs, skipped=skipped_columns)
    result = select_columns(result, effective_selected)
    # DS-LAKE-018-T02: `scaling_params` is what each scaler actually FIT on
    # these train rows — recorded below so a later holdout replay
    # (DS-LAKE-018-T04) can scale with these exact numbers instead of
    # re-fitting on itself (see finding: re-fitting is a silently DIFFERENT
    # transform from the one the model learned).
    result, scaling_params = to_model_ready(
        result, tag_columns(result), request.scalers)

    assert_frame_is_usable(result)

    stats = store.put_frame(
        result, request.target_key, overwrite=request.overwrite)

    # Exclude collided configs from the sidecar — feature_spec.json must
    # only claim features that were actually computed, not merely
    # requested. `feature_column_name` is cheap enough to recompute per
    # config here (config lists are short) rather than have
    # `apply_features` return column names paired with configs.
    computed_configs = [
        cfg for cfg in step_configs
        if feature_column_name(cfg) not in skipped_columns
    ]
    spec = build_feature_spec(
        computed_configs, effective_selected, request.scalers, request.target_y,
        scaling_params=scaling_params)
    # `source` (the SILVER parent) is already in memory from the get_frame
    # above — same shape `clean()` uses, and the only place features() holds
    # both frames at once.
    #
    # This sidecar was omitted when T05 was written on the reading that
    # column_stats is "a cleaning-op concern". That holds for `drift` alone;
    # coverage/min/max/mean/median/std describe the COLUMN, and this is the
    # one stage that MINTS columns — a derived feature (lag, rolling mean,
    # ratio) has never had stats computed anywhere upstream, because it did
    # not exist upstream. Without this the GOLD row carries
    # columnStatsKey=null, /finalize copies that null onto FINAL, and every
    # dataset that ran feature engineering — the wizard's main path — has no
    # readable statistics for its saved artifact at all.
    #
    # `drift` for a column that exists on both sides stays meaningful
    # (scaling moved the mean by exactly this much); for a newly derived
    # column `build_column_stats` already reports None, which is the
    # correct "no comparison possible", not a special case to add here.
    column_stats = build_column_stats(
        result, operations=[], parent_frame=source
    )

    return _commit(
        store,
        stats,
        started,
        parent_key=request.source_key,
        operations=step_configs,
        column_stats=column_stats,
        feature_spec=spec,
        skipped_features=skipped_columns,
    )


def validate(store: ObjectStore, request: ValidateRequest) -> dict[str, Any]:
    """DS-LAKE-007-T02. Read `source_key`, run every check, write the report
    sidecar, return it. No `_commit` here — validation writes no DATA
    artifact (AC), only the report sidecar, so `_commit`'s manifest/
    lineage machinery (built around a NEW data object) does not apply.

    `feature_spec_key` is fetched and passed through if given; a caller
    validating a BRONZE/SILVER artifact simply omits it, and
    `feature_consistency` skips rather than fails (see
    `validation_service`'s own module docstring).
    """
    frame = store.get_frame(request.source_key)
    feature_spec = (
        store.get_json(request.feature_spec_key)
        if request.feature_spec_key
        else None
    )

    kwargs: dict[str, Any] = {
        "feature_spec": feature_spec,
        "expected_tags": request.expected_tags,
    }
    if request.max_missing_pct is not None:
        kwargs["max_missing_pct"] = request.max_missing_pct
    if request.max_outlier_fraction is not None:
        kwargs["max_outlier_fraction"] = request.max_outlier_fraction

    report = run_validation(frame, **kwargs)

    report_key = sidecar_key(request.source_key, VALIDATION_REPORT_FILENAME)
    store.put_json(report_key, report)
    report["validation_report_key"] = report_key
    return report


def _paginate(store: ObjectStore, request: RowsRequest) -> tuple[pd.DataFrame, pd.DataFrame, int, bool]:
    """Shared by `rows` (JSON) and `rows_arrow` (DS-LAKE-005B-A-T05): the
    projection/time-filter/pagination logic must not diverge between the two
    formats, or "the same page" could mean two different things depending on
    which one a caller asked for.

    `tags` drives real Parquet column projection: a requested name that is
    not in the artifact reaches `pyarrow` as an unknown column and raises
    `ArrowInvalid` (a `ValueError` subclass), which `routers/preprocess._run`
    already maps to 422 — no separate validation needed here, on either path.

    Returns `(frame, page, total_row_count, is_filtered)` — `frame` is the
    whole filtered view (its columns are `tags`, its length before paging is
    `total_row_count`), `page` is the `offset:offset+limit` slice.
    """
    columns = None
    if request.tags is not None:
        columns = [TIMESTAMP_COLUMN]
        for tag in request.tags:
            columns.append(tag)
            columns.append(status_column(tag))

    frame = store.get_frame(request.source_key, columns=columns)

    is_filtered = request.start_time is not None or request.end_time is not None
    if request.start_time is not None:
        frame = frame[frame[TIMESTAMP_COLUMN]
                      >= pd.Timestamp(request.start_time)]
    if request.end_time is not None:
        frame = frame[frame[TIMESTAMP_COLUMN]
                      <= pd.Timestamp(request.end_time)]
    if is_filtered:
        frame = frame.reset_index(drop=True)

    total = int(len(frame))
    page = frame.iloc[request.offset: request.offset + request.limit].reset_index(
        drop=True
    )
    return frame, page, total, is_filtered


def rows(store: ObjectStore, request: RowsRequest) -> dict[str, Any]:
    """One page of a committed artifact, in the shape the client renders.

    `total_row_count` describes the whole FILTERED result — the tag- and
    time-narrowed view this request asked for, not the raw file — so the
    client knows when to stop paging without a separate count call, and that
    count is honest about what it is actually paging through.
    """
    frame, page, total, is_filtered = _paginate(store, request)

    return {
        "source_key": request.source_key,
        "total_row_count": total,
        "offset": request.offset,
        "tags": tag_columns(frame),
        # Echoes what was actually applied — DS-LAKE-005B-A-T02 advisor catch:
        # a filtered total_row_count that does not announce itself is a
        # client-side correctness trap (a cached "6 rows" page cannot tell a
        # narrowed window from the whole artifact without this).
        "filtered": is_filtered,
        "start_time": request.start_time,
        "end_time": request.end_time,
        # Same wide {timestamp, cells:{tag:{value,status}}} shape the preview
        # returns, so the client keeps one row renderer rather than two.
        "rows": sample_rows(page, len(page)),
    }


def rows_arrow(store: ObjectStore, request: RowsRequest) -> Response:
    """The same page as `rows`, as an Arrow IPC stream (DS-LAKE-005B-A-T05).

    Takes the sliced DataFrame straight to `pa.Table.from_pandas` — the
    physical 2N+1 columns (timestamp + one float64 per tag + one int8
    `__status` sidecar per tag), not the `{timestamp, cells: {...}}` object
    graph `sample_rows` builds for JSON. Re-shaping into that object graph
    first and THEN encoding it would move an object graph into a binary
    container and gain nothing over JSON.

    The envelope scalars JSON puts in the response body (`total_row_count`,
    `offset`, `filtered`, `start_time`, `end_time`) travel as response
    headers instead: `tags` and the page length are already intrinsic to the
    Arrow payload (schema field names, `num_rows`), and NestJS passes this
    response through without decoding it, so headers are the only place it
    — or a future client, before fully decoding the stream — can see
    pagination state.
    """
    _frame, page, total, is_filtered = _paginate(store, request)

    table = pa.Table.from_pandas(page, preserve_index=False)
    sink = pa.BufferOutputStream()
    with pa.ipc.new_stream(sink, table.schema) as writer:
        writer.write_table(table)

    headers = {
        "X-Total-Row-Count": str(total),
        "X-Offset": str(request.offset),
        "X-Filtered": "true" if is_filtered else "false",
    }
    # Header values must be strings, and absent means "no filter" — an empty
    # header would be indistinguishable from "filtered to an empty string".
    if request.start_time is not None:
        headers["X-Start-Time"] = request.start_time
    if request.end_time is not None:
        headers["X-End-Time"] = request.end_time

    return Response(
        content=sink.getvalue().to_pybytes(),
        media_type="application/vnd.apache.arrow.stream",
        headers=headers,
    )


def metadata(store: ObjectStore, request: MetadataRequest) -> dict[str, Any]:
    """Tag list and timestamp range for a committed artifact.

    Everything else the metadata endpoint reports (rowCount, columnCount,
    tagCount, missingPct, checksum, createdAt) is already on the
    DatasetArtifact row, so NestJS answers those without a call here at all
    (DS-LAKE-005B-A-T01). This exists only for the two things only the frame
    itself can answer.
    """
    meta = store.get_frame_metadata(request.source_key)
    return {
        "source_key": request.source_key,
        "tags": meta["tags"],
        "column_count": meta["column_count"],
        "row_count": meta["row_count"],
        "start_time": meta["start_time"],
        "end_time": meta["end_time"],
    }


def tag_catalog(store: ObjectStore, request: TagCatalogRequest) -> dict[str, Any]:
    """Paginated, searchable tag names — DS-LAKE-005B-A-T03.

    Built on the same footer-only read `metadata()` uses: `get_frame_metadata`
    is called once, the full tag list it returns is filtered and sliced in
    memory. No tag or status column is ever decoded, so this costs the same
    one object download regardless of how many of the 8,000+ tags match.

    `get_frame_metadata` already returns `tags` alphabetically — not re-sorted
    here, so this and `/metadata` can never silently disagree on order for the
    same artifact.
    """
    meta = store.get_frame_metadata(request.source_key)
    tags = meta["tags"]

    if request.search:
        needle = request.search.lower()
        tags = [t for t in tags if needle in t.lower()]

    total = len(tags)
    page = tags[request.offset: request.offset + request.limit]

    return {
        "source_key": request.source_key,
        "total_count": total,
        "offset": request.offset,
        "search": request.search,
        "tags": page,
    }


def column_stats(store: ObjectStore, request: ColumnStatsRequest) -> dict[str, Any]:
    """Serve the sidecar written at write time — DS-LAKE-005B-A-T07/V07.

    `store.get_json` reads ONLY `column_stats.json`; `data.parquet` is never
    opened, regardless of tag count, which is the entire reason this sidecar
    exists (8,000 tags at once would otherwise mean decoding every column).
    The sidecar key is DERIVED from `source_key` via the same `sidecar_key()`
    the write path used — not looked up from anywhere else, so read and
    write can never disagree on where it lives.

    A missing sidecar (legacy artifact written before this task, or a write
    that failed after the data commit) surfaces as `ObjectStoreError`, which
    `routers/preprocess._run` already maps to 422 — no separate handling.
    """
    key = sidecar_key(request.source_key, COLUMN_STATS_FILENAME)
    stats = store.get_json(key)
    return {
        "source_key": request.source_key,
        "column_stats_key": key,
        # dict keyed by tag on the wire, same shape build_column_stats built
        # — a client looks up one tag in O(1) rather than scanning a list.
        "stats": stats,
    }


def cleanup(store: ObjectStore, request: CleanupRequest) -> dict[str, Any]:
    """Clear a tmp prefix. `CleanupRequest` already refuses anything outside tmp/."""
    return {
        "prefix": request.prefix,
        "deleted": store.delete_prefix(request.prefix),
    }


def reclaim_artifact(
    store: ObjectStore, request: ArtifactReclaimRequest
) -> dict[str, Any]:
    """Delete one committed artifact's objects — DS-LAKE-009B.

    `ArtifactReclaimRequest` already refuses anything that is not a committed
    artifact's data key, so the prefix derived here is always
    `.../artifacts/{artifactId}/`, never `tmp/` or a preset. `delete_prefix`
    counts and removes whatever it finds and does not error on an absent
    prefix, which is what makes a retried cleanup pass converge: calling this
    twice for the same artifact returns `deleted: 0` the second time instead
    of failing.

    DS-LAKE-016-T02: prefix now comes from `split_data_key`, not a hardcoded
    `object_key[: -len(DATA_FILENAME)]` slice. Against a stage-suffixed key
    (e.g. `.../data_gold.parquet`, longer than legacy `data.parquet`), that
    old slice left a filename FRAGMENT on the prefix (`.../data_`) —
    `delete_prefix` would then silently match nothing and report success
    having deleted zero objects. `ArtifactReclaimRequest`'s own validator
    already guarantees `object_key` ends in an accepted data filename, so
    `split_data_key` here cannot return `None` — unpacking it directly (no
    `if`) makes that guarantee fail loudly, not silently, if it is ever
    violated.
    """
    prefix, _ = split_data_key(request.object_key)
    return {"prefix": prefix, "deleted": store.delete_prefix(prefix)}


def presign_artifact(store: ObjectStore, body) -> dict:
    if not is_committed_artifact_key(body.source_key):
        raise ValueError(
            f"'{body.source_key}' is not a committed artifact data key. "
            "Only .../artifacts/{artifactId}/data.parquet can be presigned "
            "for reading."
        )

    data_url = store.presigned_get(body.source_key)

    sidecar_urls: dict[str, str | None] = {}
    for filename in body.sidecars:
        key = sidecar_key(body.source_key, filename)
        # A missing sidecar is null, not a failure — see the request schema.
        sidecar_urls[filename] = store.presigned_get(
            key) if store.exists(key) else None

    meta = store.get_frame_metadata(body.source_key)

    return {
        "data_url": data_url,
        "sidecar_urls": sidecar_urls,
        # Recomputed from the stored bytes, not read off a row: this value
        # exists so the container can detect a mismatch against what NestJS
        # recorded, and reading both from the same place would prove nothing.
        "checksum": store.checksum_of(body.source_key),
        "row_count": meta["row_count"],
        "expires_at": (
            datetime.now(timezone.utc) + store.PRESIGN_READ_TTL
        ).isoformat(),
    }


def presign_model_run_upload(store: ObjectStore, body) -> dict:
    unknown = sorted(set(body.filenames) - _ALLOWED_RUN_UPLOADS)
    if unknown:
        raise ValueError(
            f"Not part of the training-run layout: {unknown}. "
            f"Allowed: {sorted(_ALLOWED_RUN_UPLOADS)}."
        )

    # EXACTLY ONE of model_id / draft_id — enforced by the request schema's
    # own validator (MODEL-FLOW-003-T08). A run started from the wizard has
    # no model_id yet and writes under drafts/ instead.
    if body.draft_id is not None:
        build_key = lambda filename: draft_run_key(  # noqa: E731
            body.draft_id, body.run_id, filename)
        is_well_formed = is_draft_run_key
        root = "drafts/"
    else:
        build_key = lambda filename: model_run_key(  # noqa: E731
            body.model_id, body.run_id, filename)
        is_well_formed = is_model_run_key
        root = "models/"

    upload_urls: dict[str, str] = {}
    for filename in body.filenames:
        key = build_key(filename)
        # Belt and braces: the allow-list above already constrains the
        # filename, but the ids come from the request too, and this predicate
        # is the one thing standing between a malformed id and a write
        # outside the owner's own root.
        if not is_well_formed(key):
            raise ValueError(
                f"Refusing to presign a write outside {root}: '{key}'")
        upload_urls[filename] = store.presigned_put(key)

    return {
        "upload_urls": upload_urls,
        "expires_at": (
            datetime.now(timezone.utc) + store.PRESIGN_WRITE_TTL
        ).isoformat(),
    }


def run_predictions(store: ObjectStore, body) -> dict[str, Any]:
    """A training run's test-split predictions, parsed — MODEL-FLOW-004.

    `predictions.parquet` is exactly `{timestamp, y_true, y_pred}` over the
    TEST split (`images/trainer/train.py`'s own write) — not the wide
    `{timestamp, tag, tag__status, ...}` shape `rows()`/`sample_rows` assume,
    which is why this is its own reader rather than a call to `rows()`.

    Guarded structurally, not by an id pair: NestJS already resolved which
    run's key this is off the `ModelTrainingRun` row before calling here —
    the same division of labour `presign_artifact` uses for a committed
    artifact's `source_key`. Both roots are accepted (`is_draft_run_key` OR
    `is_model_run_key`) because an adopted run's objects stay under
    `drafts/` permanently — Save Model adopts by pointer, never copies bytes.

    Every scalar here (`row_count`, `residual_sd`, the rmse cross-check, the
    y ranges) is computed over the FULL frame, before any point-count cap is
    applied — there is no cap to apply, since this endpoint has no
    decimation branch (`MAX_PREDICTION_POINTS`). A run whose test split
    exceeds it is refused by name rather than silently decimated.
    """
    key = body.source_key
    if key.rsplit("/", 1)[-1] != PREDICTIONS_FILENAME:
        raise ValueError(
            f"'{key}' does not name {PREDICTIONS_FILENAME}."
        )
    if not (is_draft_run_key(key) or is_model_run_key(key)):
        raise ValueError(
            f"'{key}' is not a well-formed training-run output key. Only "
            "drafts/{draftId}/runs/{runId}/... or "
            "models/{modelId}/runs/{runId}/... can be read here."
        )

    frame = store.get_frame(key)

    expected = {TIMESTAMP_COLUMN, "y_true", "y_pred"}
    actual = set(frame.columns)
    if actual != expected:
        problems = []
        missing = sorted(expected - actual)
        unexpected = sorted(actual - expected)
        if missing:
            problems.append(f"missing {missing}")
        if unexpected:
            problems.append(f"unexpected {unexpected}")
        raise ValueError(
            f"'{key}' is not a predictions frame ({', '.join(problems)}). "
            "Expected exactly timestamp/y_true/y_pred."
        )
    for column in ("y_true", "y_pred"):
        if not pd.api.types.is_numeric_dtype(frame[column]):
            raise ValueError(
                f"Column '{column}' in '{key}' is not numeric "
                f"(dtype={frame[column].dtype})."
            )

    row_count = int(len(frame))
    if row_count > MAX_PREDICTION_POINTS:
        raise ValueError(
            f"'{key}' has {row_count} rows, over the {MAX_PREDICTION_POINTS} "
            "this endpoint serves without decimation. See MODEL-FLOW-004's "
            "stated deferral for a run this large."
        )

    frame = frame.sort_values(TIMESTAMP_COLUMN).reset_index(drop=True)
    residual = frame["y_true"] - frame["y_pred"]
    sd = float(residual.std(ddof=0)) if row_count > 1 else 0.0
    rmse = float((residual ** 2).mean()) ** 0.5 if row_count else 0.0

    points = [
        {
            "timestamp": (
                ts.isoformat(sep=" ") if hasattr(ts, "isoformat") else str(ts)
            ),
            "y_true": _finite(y_true) or 0.0,
            "y_pred": _finite(y_pred) or 0.0,
        }
        for ts, y_true, y_pred in zip(
            frame[TIMESTAMP_COLUMN], frame["y_true"], frame["y_pred"]
        )
    ]

    # A missing manifest is null, not a failure — same "missing sidecar"
    # convention `presign_artifact` applies, expressed as a catch rather than
    # an `exists()` probe: with the manifest usually present (both objects
    # come from the same trainer upload), the catch is the cheaper path —
    # one round trip, not two — for the common case.
    manifest: dict[str, Any] | None = None
    if body.manifest_key:
        try:
            manifest = store.get_json(body.manifest_key)
        except ObjectStoreError:
            manifest = None

    return {
        "source_key": key,
        "row_count": row_count,
        "residual_sd": round(sd, 6),
        "residual_rmse_check": round(rmse, 6),
        "y_true_min": _finite(frame["y_true"].min()) or 0.0,
        "y_true_max": _finite(frame["y_true"].max()) or 0.0,
        "y_pred_min": _finite(frame["y_pred"].min()) or 0.0,
        "y_pred_max": _finite(frame["y_pred"].max()) or 0.0,
        "points": points,
        "derived_from_target": (
            manifest.get("derived_from_target") if manifest else None
        ),
        "target_scaled": manifest.get("target_scaled") if manifest else None,
    }
