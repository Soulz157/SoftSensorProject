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

# DS-LAKE-005B-A-T06. A chart never needs more points than it has pixels for;
# 10,000 is generous headroom above any realistic viewport width.
MAX_DOWNSAMPLE_POINTS = 10_000
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
