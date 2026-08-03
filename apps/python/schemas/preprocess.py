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

from typing import Any, Literal, Optional

from pydantic import BaseModel, Field, model_validator

from schemas.data_source import PIFetchRequest, SQLQueryRequest

# Ceilings chosen so a preview always answers inside PYTHON_TIMEOUT.metadata
# (30s) and never needs a background job.
MAX_SAMPLE_ROWS = 50_000
DEFAULT_SAMPLE_ROWS = 5_000
MAX_PREVIEW_ROWS = 200
DEFAULT_PREVIEW_ROWS = 20


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
    threshold: Optional[float] = Field(None, description="remove_outlier{zscore}")
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
    duration_ms: int


class SqlMaterializeSpec(BaseModel):
    """A SQL query plus the two things the canonical frame needs on top of it.

    `SQLQueryRequest` alone is not enough: it returns row-major records with no
    declared time axis, and the frame is built around one.
    """

    query: SQLQueryRequest
    timestamp_column: str = Field(..., examples=["ts"])
    #: Columns to keep as tags. Omitted means every column but the timestamp.
    tags: Optional[list[str]] = None


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

    @model_validator(mode="after")
    def exactly_one_source(self) -> "MaterializeRequest":
        if (self.pi is None) == (self.sql is None):
            raise ValueError(
                "Provide exactly one of 'pi' or 'sql'. A materialize with both "
                "is ambiguous, and one with neither has nothing to read."
            )
        return self


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


class RowsRequest(BaseModel):
    """Paginated read of a committed artifact, for client hydration."""

    source_key: str
    offset: int = Field(0, ge=0)
    limit: int = Field(1_000, ge=1, le=MAX_SAMPLE_ROWS)


class RowsResponse(BaseModel):
    source_key: str
    #: Total rows in the artifact, NOT in this page — the client pages until
    #: `offset + len(rows) >= total_row_count`.
    total_row_count: int
    offset: int
    tags: list[str]
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
            raise ValueError("prefix must end with '/' so it cannot match a sibling.")
        if "tmp/" not in self.prefix:
            raise ValueError(
                "Refusing to clear a prefix outside tmp/. Committed dataset "
                "versions are immutable and are never deleted by a job."
            )
        return self


class CleanupResponse(BaseModel):
    prefix: str
    deleted: int


class PreviewRequest(BaseModel):
    source_key: str = Field(
        ...,
        description="Object key of the source artifact",
        examples=["ds-1/v1.parquet"],
    )
    operations: list[CleaningOperation] = Field(default_factory=list)
    #: Per-tag decimal places. Python has no access to the client's tagMeta, so
    #: this must travel in the request or every value rounds to the default.
    precision: dict[str, int] = Field(default_factory=dict, examples=[{"TI-101": 1}])
    sample_rows: int = Field(
        DEFAULT_SAMPLE_ROWS,
        ge=1,
        le=MAX_SAMPLE_ROWS,
        description="Rows read from the head of the artifact to preview against",
    )
    preview_rows: int = Field(
        DEFAULT_PREVIEW_ROWS,
        ge=1,
        le=MAX_PREVIEW_ROWS,
        description="Rows returned in the before/after sample payload",
    )


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


class PreviewDelta(BaseModel):
    """after - before. Negative means the operations removed something."""

    row_count: int
    column_count: int
    missing_cells: int
    missing_pct: float


class PreviewResponse(BaseModel):
    source_key: str
    #: True when the artifact is larger than `sample_rows`, so the preview was
    #: computed on a HEAD WINDOW rather than the whole dataset.
    sampled: bool
    sampled_rows: int
    source_row_count: int
    before: PreviewSide
    after: PreviewSide
    delta: PreviewDelta
    #: Set when sampling could make the preview unrepresentative.
    warnings: list[str] = Field(default_factory=list)


# `RowsResponse` is declared above `PreviewRow` (requests first, responses
# after) so its annotation is still a forward reference at class-creation time.
# Resolve it here rather than reordering the file; without this the first
# request to /rows fails at serialisation, not at import, which is the worse
# place to find out.
RowsResponse.model_rebuild()
