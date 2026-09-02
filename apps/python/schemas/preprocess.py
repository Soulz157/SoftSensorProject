"""Request/response contracts for the preprocessing endpoints.

Field names are snake_case to match the rest of this service (`schemas/data.py`,
`schemas/data_source.py`). NestJS already translates between its camelCase DTOs
and this wire format in `data-source.connect.service.ts`, so the convention
holds end to end.

The operation shape mirrors the browser's saved recipe closely enough that a
`pipelineConfig` replays without a translation layer — see
`services/cleaning_service.OPERATION_ALIASES`.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal, Optional

from pydantic import BaseModel, Field, model_validator

from intergrations.object_store import (
    DATA_FILENAME,
    draft_run_prefix,
    draft_runs_prefix,
    is_committed_artifact_key,
    is_draft_run_prefix,
)
from schemas.data_source import PIFetchRequest, SQLQueryRequest

# Ceilings chosen so a preview always answers inside PYTHON_TIMEOUT.metadata
# (30s) and never needs a background job.
MAX_SAMPLE_ROWS = 50_000
DEFAULT_SAMPLE_ROWS = 5_000
MAX_PREVIEW_ROWS = 200
DEFAULT_PREVIEW_ROWS = 20

# DS-LAKE-005B-A-T06. A chart never needs more points than it has pixels for;
# 10,000 is generous headroom above any realistic viewport width.
MAX_DOWNSAMPLE_POINTS = 10_000

# MODEL-FLOW-004. `run_predictions` serves a training run's ENTIRE test split
# with no decimation branch — the largest observed run is 4,633 rows, and a
# decimated series must never feed a distribution plot (LTTB preserves a time
# series' visual shape, not its value distribution), so histogram/Q-Q would
# need a second, server-side implementation the day this cap is exceeded.
# Comfortably under MAX_SAMPLE_ROWS; a run this large is refused by name
# rather than silently decimated, so the refusal is legible when it happens.
MAX_PREDICTION_POINTS = 20_000
# When max_points is set, build_preview runs operations over the FULL
# tag/time-filtered window instead of sample_rows' head cut (V05's "local
# extrema of the source series" cannot be reachable if the series was
# truncated before LTTB ever saw it). That bypass needs its OWN ceiling, not
# a reuse of MAX_SAMPLE_ROWS — that constant also bounds RowsRequest.limit
# (T02's page-size cap), and raising it to cover a six-month/1-minute window
# would silently raise the /rows page limit too.
MAX_DOWNSAMPLE_WINDOW_ROWS = 500_000


class CleaningOperation(BaseModel):
    """One configurable cleaning step.

    `param`/`param_low` are the canonical names; the friendlier aliases exist
    because the UI speaks in domain terms (a window, a threshold, an alpha).
    Precedence when several are supplied is fixed and documented in
    `cleaning_service._PARAM_ALIASES` — it is not left to dict ordering.
    """

    type: str = Field(..., examples=["fill_missing", "remove_outlier"])
    method: Optional[str] = Field(None, examples=["linear", "iqr"])
    #: Which columns to act on. Omitted or ["*"] means every tag.
    tags: Optional[list[str]] = Field(None, examples=[["TI-101"]])

    param: Optional[float] = None
    param_low: Optional[float] = Field(None, alias="paramLow")

    # Domain-friendly aliases.
    window: Optional[int] = Field(None, description="smooth{moving_avg}")
    alpha: Optional[float] = Field(None, description="smooth{exponential}")
    threshold: Optional[float] = Field(
        None, description="remove_outlier{zscore}")
    value: Optional[float] = Field(None, description="fill_missing{constant}")
    min: Optional[float] = Field(None, description="clip lower bound")
    max: Optional[float] = Field(None, description="clip upper bound")

    model_config = {"populate_by_name": True}

    def to_step(self) -> dict[str, Any]:
        """Plain dict for `cleaning_service.apply_operations`.

        `param_low` is emitted as `paramLow` because the engine speaks the
        browser's key names, which is what makes a saved recipe replayable.
        """
        payload: dict[str, Any] = {"type": self.type}
        if self.method is not None:
            payload["method"] = self.method
        if self.tags is not None:
            payload["tags"] = self.tags

        for name in ("param", "window", "alpha", "threshold", "value", "min", "max"):
            found = getattr(self, name)
            if found is not None:
                payload[name] = found
        if self.param_low is not None:
            payload["paramLow"] = self.param_low
        return payload


class ArtifactStatsResponse(BaseModel):
    """What NestJS persists on a DatasetVersion row after a write.

    Mirrors `intergrations.object_store.ArtifactStats` field for field. NestJS
    zod-parses this before it reaches Prisma, so adding a field here without
    adding it there is a parse failure, not a silent drop.
    """

    object_key: str
    row_count: int
    #: LOGICAL tags — excludes `timestamp` and every `__status` sidecar.
    column_count: int
    size_bytes: int
    missing_pct: float
    #: sha256 of the stored Parquet bytes. Re-reading the object and re-hashing
    #: it reproduces this value, which is what makes immutability checkable
    #: rather than merely promised.
    checksum: str
    duration_ms: int
    #: DS-LAKE-005B-A-T07. The column_stats.json sidecar's key, so NestJS can
    #: persist DatasetArtifact.columnStatsKey — every materialize/clean call
    #: writes one, so this is None only for a write path this task did not
    #: reach (there are none currently).
    column_stats_key: Optional[str] = None
    #: DS-LAKE-006-T05. The feature_spec.json sidecar's key, so NestJS can
    #: persist DatasetArtifact.featureSpecKey — set only by `/features`
    #: (materialize/clean have no feature recipe to describe, so this is
    #: None for them, same reasoning as column_stats_key above being None
    #: for a write path that never produces one).
    feature_spec_key: Optional[str] = None
    #: Feature-config names `apply_features` skipped due to a name
    #: collision with an already-existing column (see `feature_service.
    #: apply_features`'s own docstring — the skip itself is unchanged,
    #: deliberately kept idempotent; this only stops feature_spec.json
    #: from claiming an uncomputed feature ran). Always [] for materialize/
    #: clean, which never call apply_features.
    skipped_features: list[str] = []
    #: DS-LAKE-018-T03. Rows written to `validate_data.parquet` — None means
    #: no holdout was requested; only `materialize()` ever sets this.
    #: BUGFIX (found during T05): `_stats_payload` has put this in the
    #: response dict since T03, but it was never declared HERE — FastAPI's
    #: `response_model=ArtifactStatsResponse` on `/materialize` was silently
    #: stripping it from every real HTTP response, so NestJS has never
    #: actually received a value (unit tests call `artifact_service.
    #: materialize` directly and never saw the gap; only a real HTTP round
    #: trip does).
    validation_row_count: Optional[int] = None
    #: DS-LAKE-018-T05. The resolved holdout boundary, same string
    #: `replay_holdout`'s own `holdout_from` expects — so NestJS can persist
    #: DatasetArtifact.validationHoldoutFrom and hand it straight back at
    #: replay time without re-deriving it. None under the same condition as
    #: validation_row_count above.
    validation_holdout_from: Optional[str] = None
    #: MODEL-FLOW-010-T06. Share of `validate_data.parquet` cells that are
    #: not Good, captured at write time while the frame is already in
    #: memory. None under the same condition as validation_row_count above.
    #: Declared here deliberately, unlike the bug T05's own comment records
    #: above — an undeclared field on this response_model is silently
    #: stripped from the real HTTP response even though `_stats_payload`
    #: puts it in the dict.
    validation_missing_pct: Optional[float] = None
    #: DS-LAKE-023-T05. Rows `drop_bad_feature_rows` removed before
    #: `to_model_ready` ran on THIS write — None for a caller that never
    #: scales (materialize/clean). Declared here for the SAME reason
    #: validation_missing_pct is, per the comment directly above: an
    #: undeclared field is silently stripped from the real HTTP response.
    dropped_bad_rows: Optional[int] = None


class ExportRequest(BaseModel):
    """DS-LAKE-021-T01. `source_key` is the committed FINAL artifact's
    data.parquet key — NestJS resolves which artifact is FINAL and passes
    its objectKey verbatim, same convention every other *Request here uses.

    DS-LAKE-021-T04: `target_key` is the EXPORT artifact's OWN key (its own
    `/artifacts/{exportArtifactId}/export.csv`, minted by NestJS the same
    way `FeaturesRequest.target_key` already is) — an export used to derive
    its own key via `sidecar_key(source_key, ...)`, landing INSIDE the
    source artifact's own prefix; reclaiming it then risked deleting the
    source's own data.parquet too. Writing to a NestJS-chosen `target_key`
    instead gives the export its own prefix, same as every other committed
    artifact type."""

    source_key: str
    target_key: str


class ExportStatsResponse(BaseModel):
    """What NestJS persists on the new EXPORT DatasetArtifact row."""

    object_key: str
    row_count: int
    #: LOGICAL tag count — __status columns are dropped, so this is the
    #: same count FINAL's own columnCount already records, not 2N+1.
    column_count: int
    size_bytes: int
    checksum: str


class ArtifactPresignRequest(BaseModel):
    model_config = {"extra": "forbid"}

    source_key: str = Field(
        ..., description="The committed artifact's data.parquet key."
    )
    #: Sidecars are opt-in per name rather than always-all: a caller that
    #: needs only the data should not be handed capabilities it has no use
    #: for. Unknown/absent sidecars come back as null, not an error — a
    #: BRONZE artifact legitimately has no feature_spec.json.
    sidecars: list[str] = Field(default_factory=list)


class ArtifactPresignResponse(BaseModel):
    data_url: str
    #: Keyed by the sidecar filename that was asked for. Null value = that
    #: sidecar does not exist on this artifact.
    sidecar_urls: dict[str, str | None]
    #: From the artifact's own bytes, so the container can verify what it
    #: downloaded against what NestJS recorded on the run row.
    checksum: str
    row_count: int
    expires_at: str


class ModelRunUploadPresignRequest(BaseModel):
    model_config = {"extra": "forbid"}

    #: EXACTLY ONE of model_id / draft_id — same "never neither" shape
    #: Prisma's ModelTrainingRun.modelId/modelDraftId CHECK constraint uses.
    #: A run started from the wizard has no model_id yet (MODEL-FLOW-003-T08)
    #: and writes under drafts/{draftId}/runs/{runId}/ instead.
    model_id: str | None = None
    draft_id: str | None = None
    run_id: str
    #: Filenames under {models|drafts}/{ownerId}/runs/{runId}/. Explicit
    #: rather than "presign everything" so a run that produced no
    #: predictions.parquet is not handed a URL implying it should have.
    filenames: list[str]

    @model_validator(mode="after")
    def exactly_one_owner(self) -> "ModelRunUploadPresignRequest":
        if (self.model_id is None) == (self.draft_id is None):
            raise ValueError(
                "Provide exactly one of 'model_id' or 'draft_id'. A presign "
                "request naming both or neither cannot resolve a single "
                "unambiguous run-output prefix."
            )
        return self


class ModelRunUploadPresignResponse(BaseModel):
    upload_urls: dict[str, str]
    expires_at: str


class ModelRunPredictionsRequest(BaseModel):
    """MODEL-FLOW-004. Reads a training run's `predictions.parquet` and
    parses it — unlike `/artifacts/presign`, which only mints a URL, this
    endpoint exists because a run's test-split predictions have no `__status`
    sidecar columns and so cannot go through `/rows`' `sample_rows` path
    (`services/preview_service.sample_rows` assumes one).

    `source_key` is guarded structurally (`is_draft_run_key` or
    `is_model_run_key`, filename `PREDICTIONS_FILENAME`) rather than by an
    id pair — NestJS already resolved which run's key this is from the
    `ModelTrainingRun` row before calling here, the same division of labour
    `/artifacts/presign` uses for a committed artifact's `source_key`.
    """

    model_config = {"extra": "forbid"}

    source_key: str = Field(
        ..., description="The run's predictions.parquet key."
    )
    #: Absent means no manifest read — `derived_from_target`/`target_scaled`
    #: come back null, same "missing sidecar is null, not a failure"
    #: convention `presign_artifact`'s `sidecars` uses.
    manifest_key: str | None = None


class RunPredictionPoint(BaseModel):
    #: ISO 8601, `sep=" "` — same convention `sample_rows`/
    #: `get_frame_metadata` already use for a parsed timestamp.
    timestamp: str
    y_true: float
    y_pred: float


class ModelRunPredictionsResponse(BaseModel):
    source_key: str
    #: Rows in the FULL frame — always `len(points)` here, because this
    #: endpoint has no decimation branch (see `MAX_PREDICTION_POINTS`). Named
    #: explicitly anyway so a caller never has to assume the two agree.
    row_count: int
    #: Residual population SD, computed over the full frame — the number the
    #: Actual-vs-Predicted and Residual charts draw their ±k·SD bands around.
    residual_sd: float
    #: Cross-check only. The run's own `metrics.json` (`r2`/`rmse`, already
    #: on the `ModelTrainingRun` row) are the numbers the UI displays; this
    #: is recomputed from `predictions.parquet` so a divergence between the
    #: two files is detectable, not so a caller has a second RMSE to choose
    #: between.
    residual_rmse_check: float
    y_true_min: float
    y_true_max: float
    y_pred_min: float
    y_pred_max: float
    points: list[RunPredictionPoint]
    #: From `run_manifest.json` when `manifest_key` was given and the object
    #: exists. `derived_from_target` is the MODEL-FLOW-000-T02 leakage
    #: guard's own record — non-empty means the request contract at serve
    #: time differs (MODEL-SERVE-002-T06), which this feature does not build
    #: but must not misrepresent by omitting. Both null if no manifest.
    derived_from_target: list[str] | None = None
    target_scaled: bool | None = None


class ModelObjectVerifyRequest(BaseModel):
    """MODEL-SERVE-001-T05. Existence + checksum check for ONE training-run
    output object, called by promote/rollback BEFORE flipping a
    `ModelVersion`'s stage. Deliberately separate from `/artifacts/presign`:
    that endpoint is hard-restricted to committed artifact `data.parquet`
    keys (`is_committed_artifact_key`), and `model.joblib` is not one —
    conflating the two guards would let a promote check accept a key it
    should refuse, or a presign accept one it should not.
    """

    model_config = {"extra": "forbid"}

    source_key: str = Field(
        ..., description="The run's model.joblib key."
    )


class ModelObjectVerifyResponse(BaseModel):
    exists: bool
    #: Recomputed from the object's own bytes, same discipline
    #: `ArtifactPresignResponse.checksum` uses — null when `exists` is
    #: false, since there is nothing to hash.
    checksum: str | None = None


class RunObjectPresignRequest(BaseModel):
    """MODEL-FLOW-016-T08/T07. Presigns a training-run-scoped object for
    READING — `validate_ready.parquet` (the model-ready holdout
    `tryReplayHoldout`, model-run.authorized.service.ts, writes under a
    run's own prefix) or `model.joblib` (the holdout-scoring container's own
    claim step, T07). Deliberately separate from `/artifacts/presign`: that
    endpoint is hard-restricted to `is_committed_artifact_key` (a committed
    DATASET artifact's data.parquet), which a run-scoped object under
    drafts/{draftId}/runs/{runId}/ or models/{modelId}/runs/{runId}/ is not
    — the exact refusal `presign_run_object`'s own docstring records as
    having silently swallowed every holdout score in this system to date.
    """

    model_config = {"extra": "forbid"}

    source_key: str = Field(
        ..., description="The run's validate_ready.parquet or model.joblib key."
    )


class RunObjectPresignResponse(BaseModel):
    data_url: str
    #: Always empty — a run-scoped object has no sidecars. Kept in the
    #: response only so its shape matches `ArtifactPresignResponse` and the
    #: TypeScript caller can reuse that same parsed type without a second
    #: zod schema.
    sidecar_urls: dict[str, str | None]
    checksum: str
    #: None for model.joblib — a pickled estimator has no row count.
    #: Real only for validate_ready.parquet.
    row_count: int | None
    expires_at: str


class RunLossHistoryRequest(BaseModel):
    """MODEL-FLOW-013-T05/T07. Reads a training run's `loss_history.json`
    verbatim — it is already the exact shape the client renders (see
    `extract_loss_history` in `images/trainer/train.py`), so this is a
    read-and-validate, not a parse-and-reshape like `run_predictions`.

    `source_key` is guarded the same structural way `run_predictions`
    guards its own — NestJS already resolved which run's key this is off
    the `ModelTrainingRun` row before calling here.
    """

    model_config = {"extra": "forbid"}

    source_key: str = Field(..., description="The run's loss_history.json key.")


class RunLossHistoryResponse(BaseModel):
    algorithm: str
    #: "rmse" for lightgbm/xgboost (the same number metrics.json reports);
    #: "loss" for mlp/hist_gradient_boosting, whose native trajectory is in
    #: the estimator's own loss units — never assumed comparable across
    #: algorithms.
    metric: str
    series: dict[str, list[float]]


class RunCvFoldsRequest(BaseModel):
    """MODEL-FLOW-016-T11. Reads a training run's `cv_folds.json` verbatim —
    already exactly the response shape (`images/trainer/train.py` writes it
    that way on purpose, MODEL-FLOW-016-T04) — a read-and-validate, not a
    parse-and-reshape, same discipline as `RunLossHistoryRequest`.

    `source_key` is guarded the same structural way `run_predictions` and
    `RunLossHistoryRequest` guard their own.
    """

    model_config = {"extra": "forbid"}

    source_key: str = Field(..., description="The run's cv_folds.json key.")


class CvFoldRecord(BaseModel):
    fold: int
    cut_timestamp: str
    train_rows: int
    test_rows: int
    distinct: int
    r2: float
    rmse: float
    mae: float
    train_r2: float
    train_rmse: float
    train_mae: float


class RunCvFoldsResponse(BaseModel):
    algorithm: str
    n_splits: int
    folds: list[CvFoldRecord]


class RunManifestRequest(BaseModel):
    """MODEL-FLOW-007-T11 / MODEL-SERVE-001-T01. Reads a training run's
    `run_manifest.json` for the fields Save Model / ModelVersion creation
    need that are NOT already a column on `ModelTrainingRun` —
    gold_object_key, artifact_checksum, target_y, algorithm, hyperparameters,
    seed, split and metrics ARE already recorded there via `complete()`'s own
    write, so duplicating those here would be a second, driftable copy of
    the same facts.

    CORRECTED 2026-09-01 (MODEL-SERVE-001-T01): this docstring previously
    listed `model_sha256` alongside those already-a-column fields. It is
    not one — verified against `schema.prisma`: `ModelTrainingRun` has
    `artifactChecksum` (data.parquet) and `tokenHash` (the run token), no
    model.joblib checksum column at all. `model_sha256` is read from the
    manifest here, same as `framework_versions` always was.

    `source_key` is guarded the same structural way `RunLossHistoryRequest`
    guards its own — NestJS already resolved which run's manifest this is off
    the `ModelTrainingRun` row before calling here.
    """

    model_config = {"extra": "forbid"}

    source_key: str = Field(..., description="The run's run_manifest.json key.")


class RunManifestResponse(BaseModel):
    #: Absent (null) for every run trained by a trainer image before 1.0.3 —
    #: Save Model must treat this as "not recorded for this run", not fail
    #: the save. sklearn is always present when set (scalers/preprocessing
    #: run through it regardless of the final estimator); lightgbm/xgboost
    #: are present only when that algorithm trained.
    framework_versions: dict[str, str] | None = None
    #: MODEL-SERVE-001-T01. sha256 of model.joblib, computed by the trainer
    #: at fit time. Null for a run trained before the manifest recorded it —
    #: `ModelVersion.modelChecksum` inherits the same honest-legacy-null
    #: policy `framework_versions` already established above.
    model_sha256: str | None = None
    #: MODEL-FLOW-016-T07. The exact columns, in the exact order, model.
    #: predict expects — no DB column carries this. Null for a run trained
    #: before this field was added, same honest-legacy-null policy.
    feature_columns: list[str] | None = None


class ValidationCheckResponse(BaseModel):
    """Mirrors `validation_service.CheckResult.to_dict()` field for field."""

    name: str
    passed: bool
    skipped: bool
    detail: str
    measured: Optional[float] = None
    threshold: Optional[float] = None
    offenders: list[str] = Field(default_factory=list)
    #: DS-LAKE-019-T01. Mirrors `CheckResult.severity` — a property of the
    #: check's NAME (`validation_service.BLOCKING_CHECKS`), not a per-result
    #: judgment call, so a client cannot drift from the server's own
    #: weighting the day a check is added.
    severity: Literal["blocking", "advisory"]


class ValidationReportResponse(BaseModel):
    """DS-LAKE-007-T02. Mirrors `validation_service.run_validation`'s return
    shape, plus the sidecar key the endpoint wrote it under (NestJS persists
    this onto DatasetArtifact.validationKey, same precedent as
    columnStatsKey/featureSpecKey)."""

    status: Literal["PASS", "FAIL"]
    #: DS-LAKE-007-T03. 100 minus the weight of every failed check, floored
    #: at 0 — see validation_service.compute_quality_score's own docstring.
    quality_score: float
    checks: list[ValidationCheckResponse]
    failed_checks: list[str]
    #: DS-LAKE-019-T01. Failed checks that did NOT flip `status` to FAIL —
    #: a strict subset of `failed_checks`. Surfaced separately so the UI can
    #: show them prominently without implying the save was blocked.
    advisory_failures: list[str] = Field(default_factory=list)
    validation_report_key: str


class SqlMaterializeSpec(BaseModel):
    """A SQL query plus the two things the canonical frame needs on top of it.

    `SQLQueryRequest` alone is not enough: it returns row-major records with no
    declared time axis, and the frame is built around one.
    """

    query: SQLQueryRequest
    timestamp_column: str = Field(..., examples=["ts"])
    #: Columns to keep as tags. Omitted means every column but the timestamp.
    tags: Optional[list[str]] = None


class HoldoutSplitRequest(BaseModel):
    """DS-LAKE-018-T03: the raw validation holdout window, selected at Step 2
    (`describeHoldoutSelection`, apps/client/lib/holdout.ts). Same string
    convention as `PIFetchRequest.start_time`/`end_time` — a local wall-clock
    string, compared directly against the materialized frame's own
    already-localised timestamps (`frame_service._normalise_timestamp`
    converts to Bangkok-naive), never re-interpreted through a second
    timezone.
    """

    from_time: str = Field(..., examples=["2026-08-01 00:00:00"])
    to_time: str = Field(..., examples=["2026-08-10 00:00:00"])


class MaterializeRequest(BaseModel):
    """Fetch from the source and write V1 (raw) in ONE hop.

    The connector fetches directly rather than NestJS fetching and forwarding
    the rows. Round-tripping millions of rows through NestJS as JSON is the
    exact failure this slice exists to remove — it would move the browser's
    memory ceiling onto the API server instead of deleting it.

    Credentials arrive in `pi`/`sql` already decrypted by NestJS, the same
    contract `/v1/data-sources/*` uses. They are never logged and never echoed
    into an error.
    """

    target_key: str = Field(..., examples=["ds-1/v1.parquet"])
    pi: Optional[PIFetchRequest] = None
    sql: Optional[SqlMaterializeSpec] = None
    #: Committed keys are immutable; only a retry writing a tmp key sets this.
    overwrite: bool = False
    #: DS-LAKE-018-T03. Absent means no holdout — behaves exactly as today.
    holdout: Optional[HoldoutSplitRequest] = None

    @model_validator(mode="after")
    def exactly_one_source(self) -> "MaterializeRequest":
        if (self.pi is None) == (self.sql is None):
            raise ValueError(
                "Provide exactly one of 'pi' or 'sql'. A materialize with both "
                "is ambiguous, and one with neither has nothing to read."
            )
        return self


class ResplitHoldoutRequest(BaseModel):
    """Re-split an EXISTING, PRISTINE (never-split) BRONZE against a holdout
    window, without re-fetching from the source.

    `source_key` MUST point at a frame `_split_holdout` has never run on —
    the caller (NestJS `resplitDraftHoldoutService`) is responsible for
    resolving the draft's pristine root and refusing an already-split one,
    since a re-split OF a split result would silently shed the rows the
    previous split already cut. `holdout` is required (not Optional, unlike
    `MaterializeRequest.holdout`): clearing a holdout never reaches this
    endpoint at all — NestJS moves the draft pointer back to the pristine
    root directly, since the unsplit artifact already IS the no-holdout
    state.
    """

    source_key: str
    target_key: str
    holdout: HoldoutSplitRequest
    #: Committed keys are immutable; only a retry writing a tmp key sets this.
    overwrite: bool = False


class CleanRequest(BaseModel):
    """Apply operations from one artifact to another.

    Source and target are distinct keys on purpose: the runner chains one call
    per operation through `tmp/{jobId}/`, so a failure leaves every earlier step
    intact and inspectable rather than a half-rewritten artifact.
    """

    source_key: str
    target_key: str
    operations: list[CleaningOperation] = Field(default_factory=list)
    precision: dict[str, int] = Field(default_factory=dict)
    #: True for tmp intermediates (a retry rewrites its own step). Must stay
    #: False for a committed version key — see ObjectStore.put_frame.
    overwrite: bool = False

    @model_validator(mode="after")
    def target_differs_from_source(self) -> "CleanRequest":
        if self.source_key == self.target_key:
            raise ValueError(
                "source_key and target_key must differ — a clean writes a new "
                "artifact and never edits its input in place."
            )
        return self


class FeatureConfigRequest(BaseModel):
    """One `FeatureConfig` (DS-LAKE-006-T02/T05). One flat model with mostly
    optional fields, same pragmatic shape as `CleaningOperation` above rather
    than eight separate discriminated classes — the union really is this
    heterogeneous client-side too (`feature-engineering.ts`'s own type).

    `kind: 'formula'` is accepted here (a caller may legitimately submit a
    recipe containing one, e.g. one saved before this port existed) but
    `feature_service.apply_features` raises `NotImplementedError` for it —
    see that module's docstring for why formula is not ported.
    """

    id: str
    kind: Literal[
        "lag", "rolling", "delta", "arith", "ratio", "log", "datetime", "formula"
    ]
    tag: Optional[str] = None
    tags: Optional[list[str]] = None
    k: Optional[int] = None
    window: Optional[int] = None
    agg: Optional[str] = None
    op: Optional[str] = None
    part: Optional[str] = None
    name: Optional[str] = None
    expr: Optional[str] = None
    vars: Optional[dict[str, str]] = None
    display: Optional[str] = None

    def to_step(self) -> dict[str, Any]:
        """Plain dict for `feature_service.apply_features`/`build_feature_spec`.

        Omits unset fields rather than sending `None` through — `feature_service`
        indexes required fields directly (`cfg['tag']`, `cfg['k']`, ...) per
        `kind`, and a present-but-`None` key would raise a different, more
        confusing error than a genuinely missing one.
        """
        payload: dict[str, Any] = {"id": self.id, "kind": self.kind}
        for name in (
            "tag",
            "tags",
            "k",
            "window",
            "agg",
            "op",
            "part",
            "name",
            "expr",
            "vars",
            "display",
        ):
            value = getattr(self, name)
            if value is not None:
                payload[name] = value
        return payload


class FeaturesRequest(BaseModel):
    """DS-LAKE-006-T05. Reads `source_key` (the SILVER artifact), writes
    `target_key` (the GOLD artifact) — applies features, then column
    selection, then scaling, in that fixed order (matching the client
    pipeline: `applyFeatures -> precleanse -> ... -> selectColumns ->
    toModelReady`; this endpoint covers the feature/select/scale tail, not
    cleaning, which already happened to produce the SILVER source).

    DS-LAKE-022-T02: `scale` (default True, so every existing caller keeps
    today's byte-identical combined write) splits the scaling tail out.
    `scale=False` produces the feature-stage artifact alone — applyFeatures
    -> selectColumns, no toModelReady, no feature_spec.json — for a caller
    that will run `ScaleRequest`/`scale()` separately afterward. Both modes
    stay live side by side; DS-LAKE-022-T04..T07 is what switches the wizard
    over and eventually retires the `scale=True` path.
    """

    source_key: str
    target_key: str
    features: list[FeatureConfigRequest] = Field(default_factory=list)
    selected_columns: Optional[list[str]] = Field(
        None, alias="selectedColumns")
    scalers: dict[str, str] = Field(default_factory=dict)
    overwrite: bool = False
    target_y: str | None = Field(
        default=None,
        description=(
            "The tag the model predicts. Recorded in feature_spec.json and "
            "force-kept through select_columns. Never scaled."
        ),
    )
    scale: bool = Field(
        default=True,
        description=(
            "DS-LAKE-022-T02. True (default): legacy combined behaviour — "
            "applyFeatures -> selectColumns -> toModelReady, feature_spec.json "
            "written here. False: applyFeatures -> selectColumns only, no "
            "scaling, no feature_spec.json — pair with a later ScaleRequest."
        ),
    )
    #: DS-LAKE-023-T01. The validation holdout window, selected AFTER feature
    #: engineering rather than at materialize time (`MaterializeRequest`'s own
    #: `holdout` field, DS-LAKE-018-T03) — same request shape, different
    #: pipeline stage. Absent means no holdout, exactly as today. Present
    #: means this call splits AFTER applyFeatures/selectColumns and BEFORE
    #: `target_key` is written: `target_key` becomes the train side,
    #: `validate_data.parquet` (written beside it via `sidecar_key`) carries
    #: the holdout window WITH its derived columns already computed — no
    #: lead-in, no later replay needed for this artifact.
    holdout: Optional[HoldoutSplitRequest] = None

    model_config = {"populate_by_name": True}

    @model_validator(mode="after")
    def target_differs_from_source(self) -> "FeaturesRequest":
        if self.source_key == self.target_key:
            raise ValueError(
                "source_key and target_key must differ — a features write "
                "produces a new artifact and never edits its input in place."
            )
        return self


class ScaleRequest(BaseModel):
    """DS-LAKE-022-T02. The trailing half of the old combined `/features`
    write, split out so a caller can run cleaning BETWEEN feature computation
    and scaling — see `services.artifact_service.scale`'s own docstring for
    why order matters here (DEFAULT_SCALER is "minmax", so an empty
    `scalers` dict still scales every column; this is never a safe no-op to
    skip calling).

    Carries the full recipe (`features`/`selected_columns`/`scalers`/
    `target_y`), not just `source_key`/`target_key`, because
    `build_feature_spec` needs all of it and this is the one call that writes
    `feature_spec.json` post-split (DS-LAKE-022 decision D2).
    """

    source_key: str
    target_key: str
    features: list[FeatureConfigRequest] = Field(default_factory=list)
    selected_columns: Optional[list[str]] = Field(
        None, alias="selectedColumns")
    scalers: dict[str, str] = Field(default_factory=dict)
    overwrite: bool = False
    target_y: str | None = Field(
        default=None,
        description=(
            "The tag the model predicts. Recorded in feature_spec.json and "
            "force-kept through select_columns. Never scaled."
        ),
    )

    model_config = {"populate_by_name": True}

    @model_validator(mode="after")
    def target_differs_from_source(self) -> "ScaleRequest":
        if self.source_key == self.target_key:
            raise ValueError(
                "source_key and target_key must differ — a scale write "
                "produces a new artifact and never edits its input in place."
            )
        return self


class ReplayHoldoutRequest(BaseModel):
    """DS-LAKE-018-T04. Replays a saved GOLD recipe over the RAW validation
    holdout (`validate_data.parquet`, DS-LAKE-018-T03), producing a
    model-ready frame the trained model can score.

    RESOLVED (user decision, not a guess): the holdout stays fully raw —
    `apply_features -> select_columns -> to_model_ready` only, the same
    tail `FeaturesRequest` runs, no `apply_operations`/cleaning step at all.
    Scaler params are SUPPLIED via `scaling_params` (DS-LAKE-018-T02's own
    `feature_spec.json` field) and never re-fit — fitting fresh on the
    holdout's own statistics is a silently DIFFERENT, wrong transform (see
    that task's own finding).
    """

    source_key: str
    target_key: str
    #: The ORIGINAL holdout boundary (same string convention as
    #: `HoldoutSplitRequest.from_time`) — rows in `source_key` before this
    #: are lead-in scaffolding for lag/rolling, trimmed AFTER replay, never
    #: scored.
    holdout_from: str
    features: list[FeatureConfigRequest] = Field(default_factory=list)
    selected_columns: Optional[list[str]] = Field(
        None, alias="selectedColumns")
    scalers: dict[str, str] = Field(default_factory=dict)
    scaling_params: dict[str, dict[str, float]] = Field(default_factory=dict)
    target_y: Optional[str] = None
    overwrite: bool = False

    model_config = {"populate_by_name": True}

    @model_validator(mode="after")
    def target_differs_from_source(self) -> "ReplayHoldoutRequest":
        if self.source_key == self.target_key:
            raise ValueError(
                "source_key and target_key must differ — a replay produces "
                "a new artifact and never edits its input in place."
            )
        return self


class ReplayHoldoutForRunRequest(BaseModel):
    """DS-LAKE-018-T05. Same replay `ReplayHoldoutRequest` runs, but sourced
    from an EXISTING GOLD's own recorded recipe instead of the caller
    re-supplying features/scalers/scaling_params by hand — this is what
    NestJS's `claim()` calls, since it never re-derives a training run's
    recipe itself. `feature_spec_key` is `ModelTrainingRun.featureSpecKey`,
    already pinned on the run row at training-create time.
    """

    feature_spec_key: str
    source_key: str
    target_key: str
    holdout_from: str
    overwrite: bool = False


class PrepareHoldoutForRunRequest(BaseModel):
    """DS-LAKE-023-T03. The SILVER-branch counterpart to
    `ReplayHoldoutForRunRequest` — for a holdout produced by the reordered
    features-stage split (`FeaturesRequest.holdout`, T01), which already
    carries its derived columns and has no lead-in rows to trim. No
    `holdout_from` field: unlike a raw BRONZE-stage holdout, there is
    nothing to trim after the fact — `_split_holdout` already wrote this
    sidecar with `lead_in=timedelta(0)`.

    Same `feature_spec_key`-sourced recipe-hydration pattern as
    `ReplayHoldoutForRunRequest` — NestJS's `claim()` never re-derives a
    training run's recipe itself.
    """

    feature_spec_key: str
    source_key: str
    target_key: str
    overwrite: bool = False


class ValidateRequest(BaseModel):
    """DS-LAKE-007-T02. Read-only against `source_key` — validation writes
    no data artifact and mutates no frame (feature AC); the ONE write this
    endpoint makes is `validation_report.json`, a sidecar beside the data,
    same as `column_stats.json`/`feature_spec.json`.

    `feature_spec_key`/`expected_tags` are both optional and independently
    meaningful: a BRONZE/SILVER artifact has no feature spec to check
    against (that check SKIPS, not fails — see `validation_service`'s own
    module docstring), and a caller that does not know the wizard's base
    tag list simply omits `expected_tags` rather than guessing one.
    """

    source_key: str
    feature_spec_key: Optional[str] = None
    expected_tags: Optional[list[str]] = None
    #: None means "use validation_service's own default" — the threshold
    #: VALUES live in one place (that module), not duplicated here.
    max_missing_pct: Optional[float] = None
    max_outlier_fraction: Optional[float] = None


class RowsRequest(BaseModel):
    """Paginated read of a committed artifact, for client hydration.

    `limit` is bounded (`MAX_SAMPLE_ROWS`) regardless of artifact size — the
    ceiling is on the REQUEST, not conditional on how big the source is
    (DS-LAKE-005B-A-T02-V01). `tags` drives real Parquet column projection in
    `artifact_service.rows`, not a post-hoc filter: a name not in the artifact
    surfaces as `pyarrow.ArrowInvalid`, which subclasses `ValueError` and is
    already mapped to 422 by `routers/preprocess._run`.
    """

    source_key: str
    offset: int = Field(0, ge=0)
    limit: int = Field(1_000, ge=1, le=MAX_SAMPLE_ROWS)
    #: Omitted or None means every tag. An explicit empty list is honoured
    #: literally — a timestamp-only page, not "all tags".
    tags: Optional[list[str]] = None
    #: Parsed with `pd.Timestamp` in `artifact_service.rows`, not validated
    #: here — one parser, one place that decides what a valid timestamp
    #: string looks like, rather than a second looser check that could accept
    #: something the real parse later rejects (or the reverse).
    start_time: Optional[str] = None
    end_time: Optional[str] = None
    #: DS-LAKE-005B-A-T05 (rescoped: /rows only, server-side transport). JSON
    #: is the default and the only format any current caller uses — Arrow is
    #: opt-in, not a replacement. "arrow" returns the raw 2N+1-column page as
    #: an Arrow IPC stream (see `routers/preprocess.read_rows`) instead of the
    #: `RowsResponse` JSON body; the envelope scalars (total_row_count,
    #: offset, filtered, start_time, end_time) travel as response headers on
    #: that path since NestJS passes the binary through without decoding it.
    format: Literal["json", "arrow"] = "json"


class MetadataRequest(BaseModel):
    """Ask for the tag list and timestamp range of a committed artifact.

    Everything else the metadata endpoint answers (rowCount, columnCount,
    tagCount, missingPct, checksum) already lives on the DatasetArtifact row —
    NestJS serves those without calling this service at all. This request is
    only for what only the frame itself can answer.
    """

    source_key: str


class MetadataResponse(BaseModel):
    source_key: str
    #: Logical tags, same definition as `tag_columns`. NestJS reports this
    #: count as `tagCount` — deliberately not `column_count` here, which is
    #: the PHYSICAL width below. The two must never be conflated.
    tags: list[str]
    #: PHYSICAL columns measured from the same schema read as `tags`:
    #: `timestamp` + one column per tag + one `__status` sidecar per tag
    #: (2N+1 for N logical tags). Measured, not derived from `len(tags)`, so
    #: it cannot silently disagree with the tag list on a legacy artifact.
    column_count: int
    row_count: int
    #: `None` for a zero-row artifact — there is no range to report.
    start_time: Optional[str] = None
    end_time: Optional[str] = None


#: Tag catalog pages default small and cap well under the row-count ceiling —
#: 8,000+ tags is the scale this exists for, not the page size.
DEFAULT_TAG_PAGE_SIZE = 100
MAX_TAG_PAGE_SIZE = 5_000


class TagCatalogRequest(BaseModel):
    """Paginated, searchable tag names for an artifact — DS-LAKE-005B-A-T03.

    Answered from the same footer-only read `MetadataRequest` uses
    (`ObjectStore.get_frame_metadata`); no tag or status column is ever
    decoded, so browsing 8,000+ tags costs one object download regardless of
    how many pages the client turns.
    """

    source_key: str
    #: Case-insensitive substring match against the tag name. Omitted or
    #: empty means every tag.
    search: Optional[str] = None
    offset: int = Field(0, ge=0)
    limit: int = Field(DEFAULT_TAG_PAGE_SIZE, ge=1, le=MAX_TAG_PAGE_SIZE)


class TagCatalogResponse(BaseModel):
    source_key: str
    #: Tags matching `search`, NOT the artifact's full tag count — the client
    #: pages until `offset + len(tags) >= total_count`, same contract as
    #: `RowsResponse.total_row_count`.
    total_count: int
    offset: int
    #: Echoed so a caller does not have to remember what it searched for.
    search: Optional[str] = None
    #: Alphabetical, not file/schema-column order — a catalog exists to be
    #: browsed, and file order is an artifact of write time, not something a
    #: user would recognise or want to scroll through.
    tags: list[str]


class TagColumnStats(BaseModel):
    """One tag's entry in column_stats.json — DS-LAKE-005B-A-T07.

    Every field except `tag`/`cleaned` is over GOOD cells only, matching
    `services.preview_service.column_stats`'s convention (a Bad cell holds
    the `0.0` hole, which must not win `min` or drag `mean` toward zero).
    """

    tag: str
    coverage: float
    null_pct: float
    outlier_count: int
    min: Optional[float] = None
    max: Optional[float] = None
    mean: Optional[float] = None
    #: `mean - parent_mean` for this tag on the immediate parent artifact.
    #: None for a lineage root (BRONZE has no parent — nothing to compare,
    #: not "zero drift") or when either side has no Good cells for the tag.
    drift: Optional[float] = None
    #: p1/p5/p10/p20/p80/p90/p95/p99 — the client's own CLIP_PRESETS points
    #: (DS-LAKE-005B-B-T01, edit 3), computed over this artifact's FULL Good
    #: population. None when there are no Good cells.
    percentiles: Optional[dict[str, float]] = None
    #: True if any operation that produced THIS artifact named this tag
    #: (omitted/["*"] on an operation means every tag).
    cleaned: bool


class ColumnStatsRequest(BaseModel):
    """Read column_stats.json beside a committed artifact — no pagination:
    the sidecar exists precisely so 8,000 tags cost the same one object
    download as one tag, so there is nothing to page through."""

    source_key: str


class ColumnStatsResponse(BaseModel):
    source_key: str
    column_stats_key: str
    #: Keyed by tag name — a client looks up one tag in O(1) rather than
    #: scanning a list, and this is a single-page response by design (see
    #: ColumnStatsRequest).
    stats: dict[str, TagColumnStats]


class FeatureSpecRequest(BaseModel):
    """DS-LAKE-025-T06. Read feature_spec.json beside a committed artifact.

    Exactly `ColumnStatsRequest`'s shape and for the same reason — the
    sidecar is whole-artifact, so there is nothing to page or filter.
    """

    source_key: str


class FeatureSpecResponse(BaseModel):
    """DS-LAKE-025-T06.

    `spec` is returned UNVALIDATED (`dict[str, Any]`, not a typed model) on
    purpose. `build_feature_spec` writes a versioned document whose shape
    widens over time (`featureVersion`, and fields like `target_scaled` /
    `derived_from_target` that are absent on older artifacts). A strict model
    here would 500 on a legacy sidecar that reads perfectly well — the same
    "only WIDENS" discipline `ALL_DATA_FILENAMES` already documents. Callers
    read the one field they need and tolerate its absence.
    """

    source_key: str
    feature_spec_key: str
    spec: dict[str, Any]


class RowsResponse(BaseModel):
    source_key: str
    #: Total rows in the FILTERED view (start_time/end_time applied), NOT the
    #: raw artifact and NOT this page — the client pages until
    #: `offset + len(rows) >= total_row_count`. Echoing `filtered` and the
    #: resolved range below is what lets a caller tell "6 rows total" from "6
    #: rows in this window of 5,000" without re-sending the request it made.
    total_row_count: int
    offset: int
    tags: list[str]
    #: True when start_time and/or end_time narrowed the frame this response
    #: was computed from.
    filtered: bool
    start_time: Optional[str] = None
    end_time: Optional[str] = None
    rows: list["PreviewRow"]


class CleanupRequest(BaseModel):
    """Delete every object under a prefix.

    Exists because NestJS deliberately holds no S3 credentials, so it cannot
    clear `tmp/{jobId}/` itself after a job succeeds or is canceled.
    """

    #: Must end in '/'. A bare key prefix would let one dataset id that is a
    #: string prefix of another ("ds-1" vs "ds-10") delete the other's data.
    prefix: str = Field(..., examples=["ds-1/tmp/job-7/"])

    @model_validator(mode="after")
    def prefix_is_a_directory(self) -> "CleanupRequest":
        if not self.prefix.endswith("/"):
            raise ValueError(
                "prefix must end with '/' so it cannot match a sibling.")
        if "tmp/" not in self.prefix:
            raise ValueError(
                "Refusing to clear a prefix outside tmp/. Committed dataset "
                "versions are immutable and are never deleted by a job."
            )
        return self


class CleanupResponse(BaseModel):
    prefix: str
    deleted: int


class ArtifactReclaimRequest(BaseModel):
    """Delete one committed artifact's stored objects (data + sidecars).

    DS-LAKE-009B. Only `ArtifactCleanupService` calls this, and only after
    Postgres has proven the artifact eligible (not reachable through any
    non-ARCHIVED DatasetVersion's lineage, and past its retention window).
    NestJS never sends an arbitrary prefix — it sends the artifact row's own
    `objectKey` (`.../artifacts/{artifactId}/data.parquet`), and the prefix is
    derived from that here, the opposite guard from `CleanupRequest`: this
    endpoint refuses anything that is NOT a committed artifact key, so it
    cannot be pointed at `tmp/`, a preset, or a legacy version key by mistake.
    """

    object_key: str = Field(..., examples=[
        "ds-1/artifacts/art-7/data.parquet"])

    @model_validator(mode="after")
    def object_key_is_a_committed_artifact(self) -> "ArtifactReclaimRequest":
        # DS-LAKE-016-T02: routed through `is_committed_artifact_key` instead
        # of duplicating its check inline — this validator IS the guard
        # `presign_artifact` shares that predicate with (see its own doc
        # comment: "the presign guard cannot drift from it"). Before this fix
        # it duplicated the OLD, legacy-`data.parquet`-only version of that
        # check, which would have refused a real stage-suffixed artifact.
        if not is_committed_artifact_key(self.object_key):
            raise ValueError(
                "object_key must be a committed artifact's data key "
                f"('.../artifacts/{{artifactId}}/{DATA_FILENAME}'). Refusing "
                "to reclaim a tmp/, preset or legacy object through this "
                "endpoint."
            )
        return self


class ArtifactReclaimResponse(BaseModel):
    prefix: str
    deleted: int


class DraftRunReclaimRequest(BaseModel):
    """Delete one ModelDraft's training-run objects — MODEL-FLOW-011-T02.

    NestJS never sends a prefix, only ids — the same discipline
    `ArtifactReclaimRequest`'s own doc comment describes. `run_id` omitted
    (or null) reclaims the WHOLE `drafts/{draft_id}/runs/` subtree in one
    call — used when none of the draft's runs are adopted (`modelId` unset
    on every one), and the one case that also catches a run prefix whose
    `ModelTrainingRun` row is already gone. `run_id` given reclaims exactly
    that one run, leaving its siblings (in particular any adopted run —
    MODEL-FLOW-011-T05) untouched.
    """

    draft_id: str = Field(..., examples=["a1b2c3d4-…"])
    run_id: str | None = Field(default=None, examples=["e5f6a7b8-…"])

    @staticmethod
    def _is_bare_segment(value: str) -> bool:
        return not value or "/" in value or value in (".", "..")

    @model_validator(mode="after")
    def ids_are_bare_segments(self) -> "DraftRunReclaimRequest":
        # A `/` or `.`/`..` here would let a caller name a path outside
        # `drafts/{draft_id}/runs/` — the exact class of bug
        # `is_model_run_key`/`is_draft_run_key` exist to catch on the
        # write side. Checked again below via the structural predicate on
        # the ASSEMBLED prefix, so a bare-segment bypass still fails closed.
        if self._is_bare_segment(self.draft_id):
            raise ValueError("draft_id must be a single non-empty path segment")
        if self.run_id is not None and self._is_bare_segment(self.run_id):
            raise ValueError("run_id must be a single non-empty path segment")
        prefix = (
            draft_run_prefix(self.draft_id, self.run_id)
            if self.run_id
            else draft_runs_prefix(self.draft_id)
        )
        if not is_draft_run_prefix(prefix):
            raise ValueError(
                "draft_id/run_id must resolve to a well-formed "
                "drafts/{draft_id}/runs/[{run_id}/] prefix"
            )
        return self


class DraftRunReclaimResponse(BaseModel):
    prefix: str
    deleted: int


class ArtifactAdoptRequest(BaseModel):
    """Copy one committed artifact's objects into a dataset's own namespace.

    DS-LAKE-025. The counterpart to `ArtifactReclaimRequest`: that one
    removes an artifact's bytes, this one gives them a permanent home.

    Called ONLY by `saveDraftAsDatasetService`, once per artifact it is
    adopting (the FINAL, and the lineage-root BRONZE the recipe replays
    from). Until this existed, Save adopted a draft artifact BY POINTER —
    the saved dataset's `objectKey` still read `drafts/{draftId}/...` for
    the rest of its life, which made a registry dataset's readability
    depend on draft-space bytes surviving forever. Two saved datasets were
    found in exactly that state with their objects already gone: Postgres
    rows live, MinIO 404. Promotion itself stays pointer-only
    (ADR-DS-LAKE-005B-B-006, `global_definition_of_done`: "Promotion
    changes metadata only; no artifact is copied or regenerated") — this
    runs at Save, a different boundary.

    Same guard as `/artifacts/reclaim`: the source must be a committed
    artifact data key, so this cannot be pointed at `tmp/`, a preset or a
    legacy version object.
    """

    object_key: str = Field(
        ...,
        description="Source artifact data key, typically under drafts/",
        examples=["drafts/draft-1/artifacts/art-7/data_gold.parquet"],
    )
    dataset_id: str = Field(..., examples=["ds-1"])
    #: The artifact row being repointed. NOT necessarily the id embedded in
    #: `object_key`: a FINAL promoted by pointer carries its parent GOLD's
    #: key, and Save adopts it under the FINAL's OWN id so the destination
    #: prefix matches the row that will name it.
    artifact_id: str = Field(..., examples=["art-9"])

    @model_validator(mode="after")
    def object_key_is_a_committed_artifact(self) -> "ArtifactAdoptRequest":
        if not is_committed_artifact_key(self.object_key):
            raise ValueError(
                "object_key must be a committed artifact's data key "
                f"('.../artifacts/{{artifactId}}/{DATA_FILENAME}'). Refusing "
                "to adopt a tmp/, preset or legacy object through this "
                "endpoint."
            )
        return self


class ArtifactAdoptResponse(BaseModel):
    source_prefix: str
    destination_prefix: str
    #: The new data key. Written back onto `DatasetArtifact.objectKey`.
    object_key: str
    #: Sidecar pointers, null when that sidecar does not exist for this
    #: artifact — the same three nullable columns the artifact row carries.
    feature_spec_key: str | None = None
    validation_key: str | None = None
    column_stats_key: str | None = None
    #: Every destination key now present, sidecars included. Counts objects
    #: already there from an earlier attempt as well as ones copied now,
    #: because the endpoint is idempotent and the caller cares that the
    #: destination is COMPLETE, not that this particular call did the work.
    keys: list[str] = Field(default_factory=list)


class PreviewRequest(BaseModel):
    source_key: str = Field(
        ...,
        description="Object key of the source artifact",
        examples=["ds-1/v1.parquet"],
    )
    operations: list[CleaningOperation] = Field(default_factory=list)
    #: Per-tag decimal places. Python has no access to the client's tagMeta, so
    #: this must travel in the request or every value rounds to the default.
    precision: dict[str, int] = Field(
        default_factory=dict, examples=[{"TI-101": 1}])
    sample_rows: int = Field(
        DEFAULT_SAMPLE_ROWS,
        ge=1,
        le=MAX_SAMPLE_ROWS,
        description="Rows read from the head of the WINDOW to preview against",
    )
    preview_rows: int = Field(
        DEFAULT_PREVIEW_ROWS,
        ge=1,
        le=MAX_PREVIEW_ROWS,
        description="Rows returned in the before/after sample payload",
    )
    #: Bounds which tags the window is built from, same projection semantics
    #: as `RowsRequest.tags` — omitted or None means every tag; an unknown
    #: name is a 422 (DS-LAKE-005B-A-T04).
    tags: Optional[list[str]] = None
    #: Bounds the TIME window the preview is computed over, applied before
    #: `sample_rows` caps it. Without this, "preview" always meant "the head
    #: of the artifact" — no way to inspect a Bad stretch in the middle of an
    #: 8,000-tag, multi-year artifact without downloading rows first.
    start_time: Optional[str] = None
    end_time: Optional[str] = None
    #: Caps the CHART series returned in `before.series`/`after.series` via
    #: server-side LTTB (DS-LAKE-005B-A-T06). When set, `sample_rows`' head
    #: cut is BYPASSED — operations run over the full tag/time-filtered
    #: window (bounded instead by MAX_DOWNSAMPLE_WINDOW_ROWS) — because a
    #: local extremum past the head cut could never be selected regardless
    #: of how good the sampler is. `rows`/`preview_rows` (the small row-level
    #: table) are unaffected; this is a separate, larger series meant for a
    #: chart, not the table.
    max_points: Optional[int] = Field(None, ge=3, le=MAX_DOWNSAMPLE_POINTS)


#: Silverman's rule-of-thumb KDE sample count, matching the client's
#: `KDE_SAMPLES` constant (tag-histogram-chart.tsx) bug-for-bug.
DEFAULT_HISTOGRAM_KDE_SAMPLES = 100
#: Matches the client's `BIN_COUNT` constant — used only to rescale KDE
#: density onto a count axis (`density * n * binWidth`), not for discrete
#: binning; the chart itself is a smoothed density curve, not bars.
DEFAULT_HISTOGRAM_BIN_COUNT = 12


class HistogramRequest(BaseModel):
    """DS-LAKE-005B-D-T01. Reuses `PreviewRequest`'s exact payload shape
    (TRANSPORT decision, DS-LAKE-005B-D.userDecisions) — a NEW endpoint, not
    an extension of `/preview`'s response, so chart cadence stays independent
    of `/preview`'s own scrubber-driven one.
    """

    source_key: str = Field(...,
                            description="Object key of the source artifact")
    operations: list[CleaningOperation] = Field(default_factory=list)
    precision: dict[str, int] = Field(default_factory=dict)
    #: Which tags to overlay — REQUIRED (unlike `PreviewRequest.tags`, which
    #: means "every tag" when omitted): a histogram/KDE domain is shared
    #: across every overlaid tag (see `histogram_service.build_histogram`),
    #: so "every tag in an 8,000-tag artifact" is never a sane default here.
    tags: list[str] = Field(..., min_length=1)
    sample_rows: int = Field(
        DEFAULT_SAMPLE_ROWS,
        ge=1,
        le=MAX_SAMPLE_ROWS,
        description="Rows systematically sampled across the WINDOW's full span to compute against (MODEL-FLOW-014-T02) — not a head cut of its earliest rows",
    )
    start_time: Optional[str] = None
    end_time: Optional[str] = None
    kde_samples: int = Field(DEFAULT_HISTOGRAM_KDE_SAMPLES, ge=3, le=500)
    bin_count: int = Field(DEFAULT_HISTOGRAM_BIN_COUNT, ge=1, le=200)


class KdePoint(BaseModel):
    x: float
    y: float


class TagHistogram(BaseModel):
    tag: str
    mean: float
    median: float
    mode: float
    std: float
    min: float
    max: float
    range: float
    #: Count of Good values this tag contributed — `densityToCount`'s `n`.
    count: int
    #: `kdeCounts` in the client's own naming — KDE density already rescaled
    #: onto the shared count axis, ready to plot with no further client math.
    kde: list[KdePoint]


class HistogramResponse(BaseModel):
    source_key: str
    #: The domain (UNPADDED, before the 50% visual pad) shared across every
    #: qualifying tag — `null` when fewer than 2 tags have >=2 Good values.
    domain_min: Optional[float] = None
    domain_max: Optional[float] = None
    tags: list[TagHistogram]
    #: Requested tags with fewer than 2 Good values in this window — excluded
    #: from `tags`/the shared domain, named so the client can say why.
    insufficient_tags: list[str]


#: Bounds the OUTLIER LIST specifically (DS-LAKE-005B-D-T03's own scope_note:
#: "CAPPED outlier list carrying its own total count") — a value with no
#: client-side equivalent, since `tagBoxplotStats` never caps its outlier
#: array today. `outlier_count` on `TagBoxplot` always carries the true,
#: uncapped total regardless of this cap.
DEFAULT_BOXPLOT_OUTLIER_CAP = 50


class BoxplotRequest(BaseModel):
    """DS-LAKE-005B-D-T03. Same payload shape as `HistogramRequest`
    (TRANSPORT decision, DS-LAKE-005B-D.userDecisions) — reuses the identical
    operations/precision/tags/sample_rows/start_time/end_time fields so this
    endpoint's reactivity mechanism is the same one `/histogram` already
    proved live against real MinIO data, not a second implementation of it.
    """

    source_key: str = Field(...,
                            description="Object key of the source artifact")
    operations: list[CleaningOperation] = Field(default_factory=list)
    precision: dict[str, int] = Field(default_factory=dict)
    #: Tags to summarize — REQUIRED, same rationale as `HistogramRequest.tags`:
    #: unlike `/preview` there is no sane "every tag" default for a chart
    #: request that returns one box per tag.
    tags: list[str] = Field(..., min_length=1)
    sample_rows: int = Field(
        DEFAULT_SAMPLE_ROWS,
        ge=1,
        le=MAX_SAMPLE_ROWS,
        description="Rows systematically sampled across the WINDOW's full span to compute against (MODEL-FLOW-014-T02) — not a head cut of its earliest rows",
    )
    start_time: Optional[str] = None
    end_time: Optional[str] = None
    outlier_cap: int = Field(DEFAULT_BOXPLOT_OUTLIER_CAP, ge=1, le=500)


class TagBoxplot(BaseModel):
    tag: str
    min: float
    q1: float
    median: float
    mean: float
    q3: float
    max: float
    #: 1.5×IQR whisker caps, clamped to the observed data range — matches
    #: `BoxplotStats.whiskerLow`/`whiskerHigh` (`lib/data-quality.ts`).
    whisker_low: float
    whisker_high: float
    #: CAPPED at the request's `outlier_cap` — see `outlier_count` for the
    #: true, uncapped total. `len(outliers) < outlier_count` means truncated.
    outliers: list[float]
    outlier_count: int
    count: int


class BoxplotResponse(BaseModel):
    source_key: str
    tags: list[TagBoxplot]
    #: Requested tags with 0 Good values in this window. NOT a port of the
    #: client's presentational `hasData` check (`min != max or median != 0`)
    #: — `boxplot_service.py::qualifies` deliberately gates on `count > 0`
    #: instead, since `hasData` mislabels a tag whose Good values are ALL
    #: exactly 0 (e.g. a valve stuck fully closed) as insufficient data,
    #: when it is real data. See `qualifies`'s own docstring for the full
    #: reasoning; DS-LAKE-005B-D-T02's chart-parity fixture
    #: `boxplot_all_zero_tag_qualifies` pins this divergence directly.
    insufficient_tags: list[str]


# MODEL-FLOW-014-T03. `tags` here is a SELECTION the panel's user makes (the
# client's own MAX_COMPARE is 5) — this cap is deliberately generous
# headroom above that, refused BY NAME rather than truncated silently, the
# same discipline MAX_PREDICTION_POINTS states on itself. If a caller ever
# needs more than this, that is a paging design to have on purpose, not a
# number to raise without noticing why it was here.
MAX_SPLIT_STATS_TAGS = 20


class SplitStatsRequest(BaseModel):
    """MODEL-FLOW-014-T03. Both sides of the train/test chronological split
    `images/trainer/train.py` would actually make for `split_ratio`, from
    ONE read of a COMMITTED artifact.

    Deliberately narrower than `BoxplotRequest`: no `operations`, no
    `precision`, no `start_time`/`end_time`. This reads a committed FINAL
    artifact — the population under test IS the whole frame, and there is no
    live-editing scrubber state to replay operations against (that is what
    `/preview` and the wizard-draft chart family are for).

    `precision` is dropped rather than kept-but-inert: `cleaning_service.
    apply_operations(frame, operations, precision)` only threads `precision`
    into `preprocess_pipelines` from INSIDE its per-operation loop
    (`for operation in operations: ... out = preprocess_pipelines(...)`).
    With `operations` empty that loop body never runs, so calling
    `apply_operations(frame, [], precision)` — which the original design
    for this schema proposed, to keep precision "working" — would in fact do
    nothing at all; `precision` would sit in the request looking load-bearing
    while every value passed through unrounded. Dropping the field is the
    honest fix, traced against `cleaning_service.py` directly rather than
    assumed.
    """

    source_key: str = Field(...,
                            description="Object key of the source artifact")
    #: Tags to summarize per side — REQUIRED, same rationale as
    #: `BoxplotRequest.tags`. Refused BY NAME past `MAX_SPLIT_STATS_TAGS`.
    tags: list[str] = Field(..., min_length=1, max_length=MAX_SPLIT_STATS_TAGS)
    #: The target column — used ONLY to derive the labelled-row mask that
    #: decides where the cut falls (mirrors `train.py::labelled_mask`
    #: exactly). Does not have to be a member of `tags`.
    target_y: str
    #: A FRACTION, never a percentage — same convention `CreateTrainingRunSchema
    #: .trainTestSplit` and `ModelDraft.splitRatio` already use. Bounds match
    #: the launch path the wizard actually calls. MODEL-FLOW-016-T02/T09:
    #: EXACTLY ONE of `split_ratio` / `n_splits` — enforced below, the same
    #: "never both, never neither" shape `ModelRunUploadPresignRequest`'s own
    #: model_id/draft_id pair uses. A single chronological cut and a k-fold
    #: expanding-window plan are different questions with different
    #: response shapes; this endpoint answers exactly one per call.
    split_ratio: float | None = Field(None, ge=0.5, le=0.95)
    #: MODEL-FLOW-016-T09. When set, the response carries a k-fold expanding
    #: fold plan instead of a single cut's box statistics. Bounds match
    #: MODEL-FLOW-016-T10's control (3-10 in the wizard); 2 is admitted here
    #: since the service-level floor is `max_admissible_k`, not the UI's own
    #: default — a caller other than the wizard should not be blocked at 3
    #: by a bound this endpoint does not itself require.
    n_splits: int | None = Field(None, ge=2, le=10)
    sample_rows: int = Field(
        DEFAULT_SAMPLE_ROWS,
        ge=1,
        le=MAX_SAMPLE_ROWS,
        description=(
            "Rows systematically sampled, per side, to compute the box "
            "statistics against. Bounds the DISPLAY sample only — the cut "
            "itself is always derived from the full labelled frame "
            "(MODEL-FLOW-014 finding: sample_rows must never determine the "
            "cut). Unused in n_splits mode, which returns no box statistics "
            "at all (MODEL-FLOW-016-T09)."
        ),
    )
    outlier_cap: int = Field(DEFAULT_BOXPLOT_OUTLIER_CAP, ge=1, le=500)

    @model_validator(mode="after")
    def _exactly_one_of_ratio_or_splits(self) -> "SplitStatsRequest":
        if (self.split_ratio is None) == (self.n_splits is None):
            raise ValueError(
                "Exactly one of split_ratio or n_splits is required — a "
                "single chronological cut and a k-fold expanding plan are "
                "different questions with different response shapes."
            )
        return self


class SplitStatsSide(BaseModel):
    """One side of the split — same shape as `BoxplotResponse` minus
    `source_key` (which belongs once, at the top of `SplitStatsResponse`),
    so the client's existing `TagBoxplotChart` (typed against
    `DraftBoxplotResult`) renders either side with no translation layer."""

    tags: list[TagBoxplot]
    insufficient_tags: list[str]


class SplitStatsFold(BaseModel):
    """MODEL-FLOW-016-T09. One expanding-window fold's plan — no box
    statistics (per this feature's own userDecisions: a CV run itself
    writes no predictions.parquet, and a per-fold box-plot pair for every
    selected tag would be k times this endpoint's existing payload for a
    number the UI does not currently show). Just enough for T11's per-fold
    table: the cut, both row counts (an expanding window's fold 1 trains on
    a fraction of what fold k does — invisible without this), and the
    fold's own distinct labelled count (T02's effective-sample-size figure,
    per fold rather than only in aggregate).
    """

    cut_timestamp: str
    train_rows: int
    test_rows: int
    distinct: int


class SplitStatsResponse(BaseModel):
    source_key: str
    target_y: str
    #: Present only in ratio mode — None in n_splits mode, where there is no
    #: single cut. MODEL-FLOW-016-T09 widens every field below split_ratio
    #: to optional for the same reason.
    split_ratio: float | None = None
    #: The cut ECHOED back — the client cannot infer which boundary it got,
    #: the same reason `/correlation` echoes its resolved tag list. This is
    #: the FIRST TEST ROW's timestamp (train = strictly before, test = at or
    #: after), matching `train.py::chronological_split`'s own convention.
    cut_timestamp: str | None = None
    train_labelled_rows: int | None = None
    test_labelled_rows: int | None = None
    #: The pre-mask row count, kept alongside so sparsity is visible in the
    #: record rather than only inferable — same reasoning
    #: `train.py`'s own `split_spec["source_rows"]` states for itself.
    source_rows: int
    train: SplitStatsSide | None = None
    test: SplitStatsSide | None = None
    #: MODEL-FLOW-016-T02. ALWAYS present, in both modes — see
    #: `build_split_stats`'s own docstring for why: the wizard needs these
    #: before the user ever opens CV mode, to disable-with-reason at config
    #: time rather than after a round trip.
    distinct_labelled_values: int
    max_admissible_k: int
    #: Present only in n_splits mode — echoes the request the same way
    #: split_ratio does for ratio mode.
    n_splits: int | None = None
    folds: list[SplitStatsFold] | None = None


#: Grid/hex-binning decimation cap for the plotted point cloud — see
#: `services.downsample.grid_bin_indices`'s own docstring
#: (ADR-DS-LAKE-005B-D-scatter-decimation) for why this is NOT `lttb_indices`.
DEFAULT_SCATTER_MAX_POINTS = 2_000


class ScatterRequest(BaseModel):
    """DS-LAKE-005B-D-T04. Similar payload shape to `HistogramRequest`/
    `BoxplotRequest` (operations/precision/sample_rows/start_time/end_time),
    but takes exactly TWO tags (`x_tag`/`y_tag`) rather than a `tags` list —
    a scatter plot has a fixed 2D shape, unlike histogram/boxplot's N-tag
    overlay.
    """

    source_key: str = Field(...,
                            description="Object key of the source artifact")
    operations: list[CleaningOperation] = Field(default_factory=list)
    precision: dict[str, int] = Field(default_factory=dict)
    x_tag: str = Field(..., min_length=1)
    y_tag: str = Field(..., min_length=1)
    sample_rows: int = Field(
        DEFAULT_SAMPLE_ROWS,
        ge=1,
        le=MAX_SAMPLE_ROWS,
        description="Rows systematically sampled across the WINDOW's full span to compute against (MODEL-FLOW-014-T02) — not a head cut of its earliest rows",
    )
    start_time: Optional[str] = None
    end_time: Optional[str] = None
    #: Caps the PLOTTED point cloud only — see `n`/regression fields on the
    #: response, which are always computed over the FULL Good-filtered
    #: frame, never the decimated sample (this task's own HARD REQUIREMENT).
    max_points: int = Field(
        DEFAULT_SCATTER_MAX_POINTS, ge=10, le=MAX_DOWNSAMPLE_POINTS
    )


class ScatterPoint(BaseModel):
    x: float
    y: float


class ScatterResponse(BaseModel):
    source_key: str
    x_tag: str
    y_tag: str
    #: Decimated for plotting — see `n` for the TRUE point count this was
    #: sampled down from.
    points: list[ScatterPoint]
    #: The TRUE count of (x, y) pairs where BOTH cells are Good — the
    #: regression below is fit over all `n` of them, never over
    #: `len(points)`. ADR-DS-LAKE-005B-D-scatter-status-filter: unlike the
    #: client's `toScatterPoints` (status-blind), a pair counts only when
    #: BOTH x and y are Good, matching histogram/boxplot's `_good_values`
    #: convention — see that ADR for why this is a deliberate, tracked
    #: divergence from the client function, not a silent "fix".
    n: int
    slope: float
    intercept: float
    r2: float
    #: Whether `points` is a strict subset of the `n` Good pairs (false
    #: when `n <= max_points`, in which case `points` IS every pair).
    downsampled: bool


#: Hard ceiling on the correlation matrix's OUTPUT size (`top_k x top_k`
#: cells) — the direction DS-LAKE-005B-D-T05b's own scope_note names as
#: the real danger: 8,000 candidate tags is not 8,000 matrix cells, it's
#: 64M. Chosen so the worst case (100x100 = 10,000 cells) stays a small
#: JSON payload regardless of how many tags `tags` names.
DEFAULT_CORRELATION_TOP_K = 20
MAX_CORRELATION_TOP_K = 100


class CorrelationRequest(BaseModel):
    """DS-LAKE-005B-D-T05b. Same operations/precision/sample_rows/
    start_time/end_time fields as Histogram/Boxplot/ScatterRequest —
    proven reactivity mechanism, not a second implementation of it.

    `tags` is the CANDIDATE universe (required, same convention as
    Histogram/Boxplot/ScatterRequest.tags) — this endpoint does not itself
    decide "every tag on the artifact". `top_k` bounds the OUTPUT: the
    response's matrix is always `len(resolved) x len(resolved)`,
    `len(resolved) <= top_k`, regardless of `len(tags)`.
    """

    source_key: str = Field(...,
                            description="Object key of the source artifact")
    operations: list[CleaningOperation] = Field(default_factory=list)
    precision: dict[str, int] = Field(default_factory=dict)
    tags: list[str] = Field(..., min_length=1)
    sample_rows: int = Field(
        DEFAULT_SAMPLE_ROWS,
        ge=1,
        le=MAX_SAMPLE_ROWS,
        description="Rows systematically sampled across the WINDOW's full span to compute against (MODEL-FLOW-014-T02) — not a head cut of its earliest rows",
    )
    start_time: Optional[str] = None
    end_time: Optional[str] = None
    top_k: int = Field(
        DEFAULT_CORRELATION_TOP_K, ge=2, le=MAX_CORRELATION_TOP_K
    )


class CorrelationResponse(BaseModel):
    source_key: str
    #: RESOLVED column list, in ranked order — the client cannot infer
    #: which columns it got (server-side auto-pick, DS-LAKE-005B-D's own
    #: userDecisions), so this MUST be echoed; `matrix[i][j]` is the
    #: correlation between `tags[i]` and `tags[j]`.
    tags: list[str]
    #: `matrix[i][i] == 1.0`; symmetric.
    matrix: list[list[float]]
    #: Which ranking metric ("iqr_median" | "cv") placed each resolved tag
    #: into `tags` — DS-LAKE-005B-D's own acceptance criteria requires the
    #: response "states the ranking metric used"; per-tag because
    #: `correlation_selector` can rank different tags by different
    #: branches within the same request (DS-LAKE-005B-D-T05a).
    column_metrics: dict[str, str]
    #: Requested tags with fewer than 2 Good values — never scored, never
    #: eligible for `tags`.
    insufficient_tags: list[str]
    #: Requested tags that WERE scored but excluded as near-constant
    #: before ranking (DS-LAKE-005B-D-T05a) — distinct from
    #: `insufficient_tags`: these have real data, just not enough
    #: variability to be worth correlating.
    near_constant_tags: list[str]
    #: `len(tags)` from the REQUEST — lets the client render "k of N,
    #: ranked by <metric>" without re-deriving N itself.
    total_candidates: int


class ColumnStats(BaseModel):
    """Per-column summary. Every statistic below is over GOOD cells only.

    Bad cells hold the `0.0` hole, so including them would drag each mean
    toward zero and report `0.0` as the minimum of a temperature column.
    """

    tag: str
    #: TOTAL rows in the window, INCLUDING the missing ones — so the number of
    #: usable observations is `count - missing`, not `count`. Spelled out
    #: because the other reading (count = observations, total = count + missing)
    #: is equally plausible and yields a wrong "% good" on screen.
    count: int
    missing: int
    #: `missing / count * 100`, consistent with the definition of `count` above.
    missing_pct: float
    min: Optional[float] = None
    max: Optional[float] = None
    mean: Optional[float] = None
    median: Optional[float] = None
    std: Optional[float] = None
    #: Same points/method as TagColumnStats.percentiles — see
    #: services.preview_service.column_stats for why THIS is the
    #: "recompute under current rules" mode (DS-LAKE-005B-B-T01, edit 3).
    percentiles: Optional[dict[str, float]] = None


class PreviewCell(BaseModel):
    value: float
    status: Literal["Good", "Bad", "Questionable"]


class PreviewRow(BaseModel):
    timestamp: str
    cells: dict[str, PreviewCell]


class PreviewSide(BaseModel):
    """One side of the comparison — the state before or after the operations."""

    row_count: int
    #: LOGICAL tags only: excludes `timestamp` and every `__status` sidecar.
    column_count: int
    missing_cells: int
    missing_pct: float
    columns: list[ColumnStats]
    rows: list[PreviewRow]
    #: True when `max_points` was requested and this side's window exceeded
    #: it. Independent of `sampled`/`sampling_warnings` on the response as a
    #: whole: those describe the small head-cut `rows` table above; this
    #: describes `series` below, a different payload with a different cap.
    downsampled: bool = False
    #: `row_count / len(series)`, this side's own — a row-removing operation
    #: can leave `after` with a different row_count than `before` even
    #: though both bucket against the SAME `bucket_edges` on the response.
    downsample_ratio: Optional[float] = None
    #: The LTTB-reduced chart series (DS-LAKE-005B-A-T06), at most
    #: `max_points` rows, spanning the FULL window rather than a head slice.
    #: `None` when `max_points` was not requested — `rows` above still
    #: carries the small preview_rows-capped table in that case, unchanged.
    series: Optional[list[PreviewRow]] = None


class PreviewDelta(BaseModel):
    """after - before. Negative means the operations removed something."""

    row_count: int
    column_count: int
    missing_cells: int
    missing_pct: float


class PreviewResponse(BaseModel):
    source_key: str
    #: True when the (tag- and time-narrowed) WINDOW is larger than
    #: `sample_rows`, so the preview was computed on a head slice of it
    #: rather than the whole window.
    sampled: bool
    sampled_rows: int
    #: The WINDOW's row count (tags/time filters applied), not the raw
    #: artifact's — same "echo what was applied" contract T02's RowsResponse
    #: uses, for the same reason: a caller cannot tell "40 rows total" from
    #: "40 rows in this time window" without this.
    source_row_count: int
    before: PreviewSide
    after: PreviewSide
    delta: PreviewDelta
    #: True when start_time and/or end_time narrowed the window.
    filtered: bool = False
    start_time: Optional[str] = None
    end_time: Optional[str] = None
    #: Echoes the request's max_points — None when not requested. Shared
    #: envelope field; `before.series`/`after.series` carry the per-side
    #: payloads, `before.downsampled`/`after.downsample_ratio` the per-side
    #: state.
    max_points: Optional[int] = None
    #: The SAME edges both `before.series` and `after.series` were bucketed
    #: against (DS-LAKE-005B-A-T06/V06) — computed once from the before
    #: window's span, reused for after regardless of its own row_count, so a
    #: before/after diff can only come from the operations, never from the
    #: sampler picking different boundaries for each side. `None` unless
    #: max_points was requested and at least one side was actually reduced.
    bucket_edges: Optional[list[str]] = None
    #: Set when sampling could make the preview unrepresentative.
    warnings: list[str] = Field(default_factory=list)


# `RowsResponse` is declared above `PreviewRow` (requests first, responses
# after) so its annotation is still a forward reference at class-creation time.
# Resolve it here rather than reordering the file; without this the first
# request to /rows fails at serialisation, not at import, which is the worse
# place to find out.
RowsResponse.model_rebuild()
