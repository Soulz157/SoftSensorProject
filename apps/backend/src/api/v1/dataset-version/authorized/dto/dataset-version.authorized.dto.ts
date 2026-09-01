import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

/**
 * Contracts for dataset versions and preprocessing jobs.
 *
 * Two kinds of schema live here and they are not interchangeable:
 *
 *   * REQUEST schemas validate what the browser sends (via createZodDto).
 *   * PYTHON RESPONSE schemas validate what the connector sends back.
 *
 * The second kind exists because `postToPython` returns `(await res.json()) as
 * TRes` — an unchecked cast. Row counts and object keys crossing that wire are
 * written straight onto DatasetVersion rows, so a connector that changed shape
 * would silently persist zeros and nulls. Parsing turns that into a loud
 * failure at the boundary instead.
 *
 * The connector speaks snake_case (apps/python/schemas/preprocess.py); the
 * mapping to camelCase columns happens here, in one place.
 */

// ── cleaning operations ────────────────────────────────────────────────────

/**
 * Mirrors apps/python `schemas.preprocess.CleaningOperation`.
 *
 * Deliberately permissive on `type`/`method`: the operation registry lives in
 * Python and is the single source of truth for which ones exist. Duplicating
 * that list here would create a second place to update, and the two would
 * drift — an unknown operation already comes back as an actionable 422.
 */
export const CleaningOperationSchema = z.object({
  type: z.string().min(1),
  method: z.string().optional(),
  tags: z.array(z.string()).optional(),
  param: z.number().optional(),
  paramLow: z.number().optional(),
  window: z.number().int().optional(),
  alpha: z.number().optional(),
  threshold: z.number().optional(),
  value: z.number().optional(),
  min: z.number().optional(),
  max: z.number().optional(),
});

export type CleaningOperation = z.infer<typeof CleaningOperationSchema>;

// ── feature engineering (DS-LAKE-006) ───────────────────────────────────────

/**
 * Mirrors apps/python `schemas.preprocess.FeatureConfigRequest`. One flat
 * schema with mostly-optional fields, same pragmatic shape as
 * `CleaningOperationSchema` above rather than a discriminated union per
 * `kind` — the client's own `FeatureConfig` type is this heterogeneous too.
 */
export const FeatureConfigSchema = z.object({
  id: z.string().min(1),
  kind: z.enum([
    'lag',
    'rolling',
    'delta',
    'arith',
    'ratio',
    'log',
    'datetime',
    'formula',
  ]),
  tag: z.string().optional(),
  tags: z.array(z.string()).optional(),
  k: z.number().int().optional(),
  window: z.number().int().optional(),
  agg: z.string().optional(),
  op: z.string().optional(),
  part: z.string().optional(),
  name: z.string().optional(),
  expr: z.string().optional(),
  vars: z.record(z.string(), z.string()).optional(),
  display: z.string().optional(),
});

export type FeatureConfig = z.infer<typeof FeatureConfigSchema>;

/**
 * Mirrors apps/python `schemas.preprocess.FeaturesRequest`'s payload half
 * (`source_key`/`target_key` are server-computed from the draft/artifact ids
 * in the route, not client-supplied, unlike the Python schema which is
 * called directly).
 */
export const CreateFeaturesSchema = z.object({
  features: z.array(FeatureConfigSchema).default([]),
  selectedColumns: z.array(z.string()).nullable().optional(),
  scalers: z.record(z.string(), z.string()).default({}),
  overwrite: z.boolean().optional(),
  // The tag a downstream training run predicts (MODEL-FLOW-000-T02).
  // Optional: this endpoint also writes GOLD artifacts nothing will ever
  // train on. Forwarded to python as target_y, never scaled, force-kept
  // through column selection — see FeaturesRequest.target_y.
  targetY: z.string().nullable().optional(),
  /**
   * DS-LAKE-022-T03. Which pipeline ORDER this job belongs to, expressed as
   * "does this stage also scale?" rather than a version number the client
   * would have to know.
   *
   * Omitted / true (every client that exists today): legacy combined write —
   * applyFeatures -> selectColumns -> toModelReady, feature_spec.json written
   * here, committed as GOLD. Unchanged in every observable way.
   *
   * false (the reordered wizard, DS-LAKE-022-T04..T07): feature stage only —
   * applyFeatures -> selectColumns, NO scaling and NO feature_spec.json,
   * committed as SILVER with pipelineVersion 2. The scaling tail runs at the
   * end of the CLEAN job instead (StartCleanJobSchema.scaleRecipe), which is
   * what lets cleaning act on un-laundered Bad cells — the whole point of the
   * reorder (DS-LAKE-022-T02's own finding: to_model_ready forces every
   * finite cell Good, so cleaning after the combined write has nothing left
   * to clean).
   */
  scale: z.boolean().optional(),
  /**
   * DS-LAKE-023-T01. The validation holdout window, selected AFTER feature
   * engineering rather than at fetch time (`CreateRawVersionSchema`'s own
   * `holdout` field, DS-LAKE-018-T03) — same shape, different pipeline
   * stage. Absent means no holdout, exactly as today. Present means this
   * job's Python call splits AFTER applyFeatures/selectColumns: the
   * committed SILVER becomes the train side, and `validate_data.parquet`
   * (written beside it) carries the holdout window WITH its derived
   * columns already computed — no lead-in, no later replay for this
   * artifact. Forwarded to Python as `FeaturesRequest.holdout`, same
   * `{from_time, to_time}` field names as `MaterializeRequest.holdout`.
   */
  holdout: z
    .object({ from: z.string().min(1), to: z.string().min(1) })
    .optional(),
});

// ── requests ───────────────────────────────────────────────────────────────

/**
 * Materialize V1 (raw) from a saved data source.
 *
 * Credentials are NOT accepted here. They are loaded and decrypted server-side
 * from the DataSource row; taking them from the browser would put a decrypted
 * secret on a request the browser can read, store and replay.
 */
export const CreateRawVersionSchema = z.object({
  sourceId: z.string().uuid(),
  tags: z.array(z.string()).min(1),
  startTime: z.string().min(1),
  endTime: z.string().min(1),
  summaryDuration: z.string().optional(),
  /** SQL sources only — the canonical frame is built around a declared axis. */
  timestampColumn: z.string().optional(),
  table: z.string().optional(),
  /**
   * Groups this artifact into an existing BRONZE -> SILVER -> GOLD -> FINAL
   * chain. Optional: a fetch normally STARTS a run, so the server mints one
   * when the caller does not supply it. Present so a re-fetch inside a wizard
   * session can stay in the same run rather than orphaning the lineage.
   */
  runId: z.string().uuid().optional(),
  /**
   * DS-LAKE-018-T03. The raw validation holdout window, selected beside
   * `startTime`/`endTime` at Step 2 (`dwHoldoutRangeAtom`,
   * `describeHoldoutSelection` in lib/holdout.ts). Optional: absent means no
   * holdout, the dataset behaves exactly as today (acceptance criterion).
   */
  holdout: z
    .object({ from: z.string().min(1), to: z.string().min(1) })
    .optional(),
});

export const StartCleanJobSchema = z.object({
  /**
   * No `.min(1)` since DS-LAKE-022-T03: a reordered-wizard clean job may
   * legitimately carry ZERO operations — a draft with features but no
   * cleaning rules still needs its GOLD written, and under the new order the
   * scaling tail that writes it lives here (`scaleRecipe` below).
   *
   * An empty array with NO `scaleRecipe` is still refused, just one layer
   * later: the runner's own `if (!stats)` guard fails the job with "A
   * cleaning job needs at least one operation" rather than committing an
   * artifact nothing was applied to. Kept there rather than re-added here as
   * a cross-field `.refine`, which would turn this schema into a ZodEffects
   * and change what `createZodDto` generates for the whole endpoint.
   */
  operations: z.array(CleaningOperationSchema),
  /** Per-tag decimal places; Python cannot see the client's tagMeta. */
  precision: z.record(z.string(), z.number().int()).default({}),
  /**
   * DS-LAKE-022-T03. Present ONLY from the reordered wizard: the feature
   * recipe whose scaling tail runs after this job's cleaning operations,
   * turning `clean` into clean-then-scale and committing GOLD (pipelineVersion
   * 2) instead of SILVER.
   *
   * Deliberately NOT named `features`, and that is load-bearing. Both
   * `readOperations` and `readFeatureRecipe` disambiguate a stored job payload
   * by asking whether a top-level `features` key is present — a CLEAN payload
   * carrying `features` would trip `readOperations`' "this is a feature
   * recipe, refusing to run as CLEAN" guard and fail every reordered clean
   * job. A distinct key keeps both guards meaning exactly what they mean
   * today.
   *
   * The recipe is carried, not re-applied: the source artifact already holds
   * the engineered and selected columns. Python needs it only to write
   * feature_spec.json at the stage that now owns it (DS-LAKE-022 decision
   * feature_spec_ownership_moves_to_scale_stage).
   */
  scaleRecipe: CreateFeaturesSchema.optional(),
});

export const ListRowsSchema = z.object({
  offset: z.coerce.number().int().nonnegative().default(0),
  /**
   * Bounded regardless of dataset size (DS-LAKE-005B-A-T02): this ceiling is
   * not conditional on the artifact being large — a request over it fails
   * validation (this schema, via the global ZodValidationPipe) on a 6-row
   * artifact exactly as it would on an 8,000-tag one.
   */
  limit: z.coerce.number().int().min(1).max(50_000).default(1_000),
  /**
   * Comma-separated, not a repeated query key — this app registers no `qs`
   * parser (checked `main.ts`), so Fastify's default querystring handling
   * would give a bare string for one tag and an array for two, which is the
   * exact ambiguity a comma-separated value avoids.
   */
  tags: z
    .string()
    .transform((v) => {
      // An empty query value ("?tags=") means "no filter was given", not
      // "return zero tags" — Python treats `tags: undefined` as every tag,
      // and sending `[]` through would silently produce a timestamp-only
      // page instead. The two layers must agree on which value means "all".
      const parsed = v.split(',').filter(Boolean);
      return parsed.length > 0 ? parsed : undefined;
    })
    .optional(),
  startTime: z.string().optional(),
  endTime: z.string().optional(),
  /**
   * DS-LAKE-005B-A-T05 (rescoped: server-side transport only). `json`
   * (default) is unchanged — every existing caller gets the same body it
   * always did. `arrow` returns the page as an Arrow IPC stream instead;
   * the controller passes it through as raw bytes, bypassing this DTO's own
   * response typing entirely (see `listArtifactRowsController`).
   */
  format: z.enum(['json', 'arrow']).default('json'),
});

/**
 * Paginated, searchable tag catalog (DS-LAKE-005B-A-T03). A separate schema
 * from `ListRowsSchema`, not a shared one: the two paginate different
 * things (tag names vs. rows) with different, independently-scaled bounds —
 * collapsing them would tie a tag-catalog page size to a row-limit ceiling
 * that has nothing to do with it.
 */
export const TagCatalogSchema = z.object({
  /** Case-insensitive substring match. Empty/omitted means every tag. */
  search: z.string().optional(),
  offset: z.coerce.number().int().nonnegative().default(0),
  limit: z.coerce.number().int().min(1).max(5_000).default(100),
});

export const PreviewVersionSchema = z.object({
  operations: z.array(CleaningOperationSchema).default([]),
  precision: z.record(z.string(), z.number().int()).default({}),
  sampleRows: z.number().int().min(1).max(50_000).optional(),
  previewRows: z.number().int().min(1).max(200).optional(),
  /**
   * Bounds which tags the preview window is built from (DS-LAKE-005B-A-T04).
   * A JSON body field, not a query string — unlike `ListRowsSchema.tags`
   * this needs no comma-separated workaround.
   */
  tags: z.array(z.string()).optional(),
  /** Bounds the TIME window the preview is computed over. */
  startTime: z.string().optional(),
  endTime: z.string().optional(),
  /**
   * Caps the CHART series in `before.series`/`after.series` via server-side
   * LTTB (DS-LAKE-005B-A-T06). Scoped to preview only — NOT added to
   * `ListRowsSchema`: `/rows`' `offset`/`limit` page against `totalRowCount`
   * (T02), and downsampling would return fewer rows than the page describes,
   * breaking that contract for no verification item that names `/rows`.
   * Recorded as an open acceptance-criterion gap in
   * `feature_list.preprocessing.json` rather than silently decided.
   */
  maxPoints: z.number().int().min(3).max(10_000).optional(),
});

/**
 * DS-LAKE-005B-D-T01. Reuses `PreviewVersionSchema`'s payload shape
 * (TRANSPORT decision, DS-LAKE-005B-D.userDecisions) — a NEW endpoint, not
 * an extension of `/preview`'s response, so chart cadence stays independent
 * of the scrubber's own.
 *
 * `tags` is REQUIRED here (unlike `PreviewVersionSchema.tags`, which means
 * "every tag"): the histogram/KDE domain is shared across every overlaid
 * tag, so "every tag in an 8,000-tag artifact" is never a sane default.
 */
export const HistogramRequestSchema = z.object({
  operations: z.array(CleaningOperationSchema).default([]),
  precision: z.record(z.string(), z.number().int()).default({}),
  tags: z.array(z.string()).min(1),
  sampleRows: z.number().int().min(1).max(50_000).optional(),
  startTime: z.string().optional(),
  endTime: z.string().optional(),
  kdeSamples: z.number().int().min(3).max(500).optional(),
  binCount: z.number().int().min(1).max(200).optional(),
});

export class HistogramRequestDto extends createZodDto(HistogramRequestSchema) {}

/**
 * DS-LAKE-005B-D-T03. Same TRANSPORT shape as `HistogramRequestSchema` —
 * the box plot reuses the identical payload fields, proven live for
 * `/histogram` already, rather than a second implementation of the same
 * reactivity mechanism.
 */
export const BoxplotRequestSchema = z.object({
  operations: z.array(CleaningOperationSchema).default([]),
  precision: z.record(z.string(), z.number().int()).default({}),
  tags: z.array(z.string()).min(1),
  sampleRows: z.number().int().min(1).max(50_000).optional(),
  startTime: z.string().optional(),
  endTime: z.string().optional(),
  /** Caps the OUTLIER LIST only — `outlierCount` on each tag always carries
   * the true, uncapped total regardless of this cap. */
  outlierCap: z.number().int().min(1).max(500).optional(),
});

export class BoxplotRequestDto extends createZodDto(BoxplotRequestSchema) {}

/**
 * MODEL-FLOW-014-T04. Deliberately narrower than `BoxplotRequestSchema`: no
 * `operations`, no `precision`, no `startTime`/`endTime`. This reads a
 * committed FINAL artifact for a fixed, server-derived split — there is no
 * live-editing scrubber state to replay operations against, and
 * `precision` was dropped from the Python schema entirely (traced
 * `apply_operations`: it is a no-op with an empty `operations` list, so
 * keeping the field here would carry a value the connector can never use).
 * `splitRatio` bounds are INCLUSIVE (0.5-0.95), matching
 * `CreateTrainingRunSchema.trainTestSplit` — the launch path the wizard
 * actually calls — not `CreateModelRunSchema.splitRatio`'s exclusive
 * `gt/lt`, a second, older bound this codebase also carries.
 */
export const SplitStatsRequestSchema = z.object({
  tags: z.array(z.string()).min(1).max(20),
  targetY: z.string().min(1),
  splitRatio: z.number().min(0.5).max(0.95),
  sampleRows: z.number().int().min(1).max(50_000).optional(),
  outlierCap: z.number().int().min(1).max(500).optional(),
});

export class SplitStatsRequestDto extends createZodDto(
  SplitStatsRequestSchema,
) {}

/**
 * DS-LAKE-005B-D-T04. Similar payload shape to `HistogramRequestSchema`/
 * `BoxplotRequestSchema` (operations/precision/sampleRows/startTime/
 * endTime), but takes exactly TWO tags (`xTag`/`yTag`) rather than a `tags`
 * list — a scatter plot has a fixed 2D shape, unlike histogram/boxplot's
 * N-tag overlay.
 */
export const ScatterRequestSchema = z.object({
  operations: z.array(CleaningOperationSchema).default([]),
  precision: z.record(z.string(), z.number().int()).default({}),
  xTag: z.string().min(1),
  yTag: z.string().min(1),
  sampleRows: z.number().int().min(1).max(50_000).optional(),
  startTime: z.string().optional(),
  endTime: z.string().optional(),
  /** Caps the PLOTTED point cloud only — `n` and the regression fields on
   * the response are always computed over the FULL Good-filtered frame. */
  maxPoints: z.number().int().min(10).max(10_000).optional(),
});

export class ScatterRequestDto extends createZodDto(ScatterRequestSchema) {}

/**
 * DS-LAKE-005B-D-T05b. `tags` is the CANDIDATE universe (same required-list
 * convention as Histogram/Boxplot/ScatterRequestSchema); `topK` bounds the
 * OUTPUT — the response's matrix is always `resolved.length x
 * resolved.length`, `resolved.length <= topK`, regardless of `tags.length`.
 * The one field in this feature that can regress DS-LAKE-005B-B's AC5 on
 * its own if left unbounded (8,000 tags² is 64M matrix cells).
 */
export const CorrelationRequestSchema = z.object({
  operations: z.array(CleaningOperationSchema).default([]),
  precision: z.record(z.string(), z.number().int()).default({}),
  tags: z.array(z.string()).min(1),
  sampleRows: z.number().int().min(1).max(50_000).optional(),
  startTime: z.string().optional(),
  endTime: z.string().optional(),
  topK: z.number().int().min(2).max(100).optional(),
});

export class CorrelationRequestDto extends createZodDto(
  CorrelationRequestSchema,
) {}

/**
 * DS-LAKE-007-T04, thin-endpoint scope: calls Python, zod-parses the
 * response, returns it. No DatasetArtifact row is created or updated here
 * — the schema's own comment ("validationKey on FINAL") anticipates a
 * later task adopting this into a FINAL artifact; that decision was
 * deliberately deferred (AskUserQuestion, this task), not silently taken.
 *
 * No `featureSpecKey` field here on purpose: the artifact BEING validated
 * already carries its OWN `featureSpecKey` column (set at write time by
 * DS-LAKE-006-T06, null for BRONZE/SILVER) — the service reads that
 * directly rather than asking the caller to separately name a spec, which
 * would just be a second way to pass the WRONG one.
 */
export const ValidateArtifactSchema = z.object({
  expectedTags: z.array(z.string()).optional(),
  maxMissingPct: z.number().optional(),
  maxOutlierFraction: z.number().optional(),
});

/**
 * DS-LAKE-009-T01. Same override fields as `ValidateArtifactSchema` — this
 * endpoint re-validates the source artifact itself (never trusts a
 * client-supplied report; see `promoteDraftArtifactToFinalService`'s own
 * doc comment) — kept as its OWN schema rather than reused, matching this
 * file's one-schema-per-endpoint convention (`CreateFeaturesSchema` vs
 * `ValidateArtifactSchema` are separate despite both wrapping a Python
 * call too).
 */
export const PromoteFinalArtifactSchema = z.object({
  expectedTags: z.array(z.string()).optional(),
  maxMissingPct: z.number().optional(),
  maxOutlierFraction: z.number().optional(),
});

/**
 * DS-LAKE-010-T01. NOT the same concept as `PromoteFinalArtifactSchema`
 * above — that one promotes a DRAFT ARTIFACT (BRONZE/SILVER/GOLD) to FINAL,
 * inside Save Dataset. This one moves a saved DatasetVersion's own
 * `status` through the registry lifecycle
 * (DRAFT -> VALIDATED -> ACTIVE -> DEPRECATED -> ARCHIVED,
 * lib/dataset-version-transitions.ts). Named `...VersionStatus...`
 * specifically so the two never get confused at a call site.
 */
export const PromoteVersionStatusSchema = z.object({
  status: z.enum(['DRAFT', 'VALIDATED', 'ACTIVE', 'DEPRECATED', 'ARCHIVED']),
});

export class CreateRawVersionDto extends createZodDto(CreateRawVersionSchema) {}
export class StartCleanJobDto extends createZodDto(StartCleanJobSchema) {}
export class CreateFeaturesDto extends createZodDto(CreateFeaturesSchema) {}
export class ValidateArtifactDto extends createZodDto(ValidateArtifactSchema) {}
export class PromoteFinalArtifactDto extends createZodDto(
  PromoteFinalArtifactSchema,
) {}
export class PromoteVersionStatusDto extends createZodDto(
  PromoteVersionStatusSchema,
) {}
export class ListRowsDto extends createZodDto(ListRowsSchema) {}
export class TagCatalogDto extends createZodDto(TagCatalogSchema) {}
export class PreviewVersionDto extends createZodDto(PreviewVersionSchema) {}

// ── Python responses (parse, never cast) ───────────────────────────────────

/** apps/python `schemas.preprocess.ArtifactStatsResponse`. */
export const ArtifactStatsSchema = z.object({
  object_key: z.string().min(1),
  row_count: z.number().int().nonnegative(),
  /** LOGICAL tags — excludes `timestamp` and every `__status` sidecar. */
  column_count: z.number().int().nonnegative(),
  size_bytes: z.number().int().nonnegative(),
  missing_pct: z.number(),
  /**
   * sha256 of the stored Parquet bytes, captured at write time.
   *
   * Required, not optional: Python sets it on every ArtifactStats return, and
   * an optional field here would let a future path that forgets it slip past
   * the parser and persist an artifact whose immutability cannot be checked.
   */
  checksum: z.string().length(64),
  duration_ms: z.number().int().nonnegative(),
  /**
   * DS-LAKE-005B-A-T07. The column_stats.json sidecar's key — persisted onto
   * DatasetArtifact.columnStatsKey. Optional/nullable: pre-T07 writes never
   * sent this field, and the response would otherwise fail to parse for a
   * connector mid-rollout.
   */
  column_stats_key: z.string().nullable().optional(),
  /**
   * DS-LAKE-006-T05. The feature_spec.json sidecar's key — persisted onto
   * DatasetArtifact.featureSpecKey. Optional/nullable: only `/features`
   * writes set it; every earlier write path never sends this field.
   */
  feature_spec_key: z.string().nullable().optional(),
  /**
   * Feature-config names skipped due to a name collision with an
   * already-existing column (`feature_service.apply_features`'s own
   * docstring). Always [] for materialize/clean, which never call
   * apply_features; optional so a pre-this-field Python response still
   * parses.
   */
  skipped_features: z.array(z.string()).optional(),
  /**
   * DS-LAKE-018-T03. Rows written to `validate_data.parquet` — set only by
   * `materialize` when the request carried a `holdout`. Null/absent means
   * no holdout (every non-materialize call, and every materialize call
   * before this task) — persisted onto DatasetArtifact.validationRowCount.
   */
  validation_row_count: z.number().int().nonnegative().nullable().optional(),
  /**
   * DS-LAKE-018-T06. The resolved holdout boundary (canonicalised by
   * `pd.Timestamp` at split time) — set by `materialize` and `resplit-
   * holdout` alike whenever a holdout was applied. Persisted onto
   * DatasetArtifact.validationHoldoutFrom, which `replay_holdout_for_run`'s
   * caller (`model-run.authorized.service.ts`) reads to know where the
   * holdout window starts. Optional/nullable so a pre-this-field response
   * still parses.
   */
  validation_holdout_from: z.string().nullable().optional(),
  /**
   * MODEL-FLOW-010-T06. Share of `validate_data.parquet` cells that are not
   * Good, captured at write time (`missing_pct(validate_frame)`) — set by
   * `materialize` and `resplit-holdout` alike whenever a holdout was
   * applied. Persisted onto DatasetArtifact.validationMissingPct. Null under
   * the same condition as validation_row_count above; optional so a
   * pre-this-field response still parses.
   */
  validation_missing_pct: z.number().nullable().optional(),
  /**
   * DS-LAKE-023-T05. Rows `drop_bad_feature_rows` removed before
   * `to_model_ready` ran on THIS write — set only by `scale` and
   * `features` (when it scales). Null/absent means either no scaling
   * happened on this write, or a pre-this-field response — persisted onto
   * DatasetArtifact.droppedBadRows.
   */
  dropped_bad_rows: z.number().int().nonnegative().nullable().optional(),
});

export type ArtifactStats = z.infer<typeof ArtifactStatsSchema>;

/** Mirrors apps/python `schemas.preprocess.ExportStatsResponse`. */
export const ExportStatsSchema = z.object({
  object_key: z.string().min(1),
  row_count: z.number().int().nonnegative(),
  column_count: z.number().int().nonnegative(),
  size_bytes: z.number().int().nonnegative(),
  checksum: z.string().length(64),
});
export type ExportStats = z.infer<typeof ExportStatsSchema>;

// ── validation (DS-LAKE-007) ────────────────────────────────────────────
// ValidateArtifactSchema itself lives earlier, alongside the other request
// schemas (CreateFeaturesSchema etc.) — only the PYTHON RESPONSE shapes
// belong in this section, same convention as ArtifactStatsSchema above.

/** Mirrors apps/python `schemas.preprocess.ValidationCheckResponse`. */
export const ValidationCheckSchema = z.object({
  name: z.string(),
  passed: z.boolean(),
  skipped: z.boolean(),
  detail: z.string(),
  measured: z.number().nullable().optional(),
  threshold: z.number().nullable().optional(),
  offenders: z.array(z.string()),
  // DS-LAKE-019-T03. A property of the check's NAME, mirrored from
  // validation_service.BLOCKING_CHECKS — never re-derived here.
  severity: z.enum(['blocking', 'advisory']),
});

/** Mirrors apps/python `schemas.preprocess.ValidationReportResponse`. */
export const ValidationReportSchema = z.object({
  status: z.enum(['PASS', 'FAIL']),
  quality_score: z.number(),
  checks: z.array(ValidationCheckSchema),
  failed_checks: z.array(z.string()),
  // DS-LAKE-019-T03. Failed checks that did NOT flip `status` to FAIL — a
  // strict subset of `failed_checks`. zod strips unknown fields by default
  // (no `.strict()`/`.passthrough()` here), so this MUST be declared or it
  // is silently dropped past this boundary — same class of failure
  // DS-LAKE-005B-B-T01's #7 percentile work already hit once.
  advisory_failures: z.array(z.string()).default([]),
  validation_report_key: z.string(),
});

const TagColumnStatsSchema = z.object({
  tag: z.string(),
  coverage: z.number(),
  null_pct: z.number(),
  outlier_count: z.number().int(),
  min: z.number().nullable().optional(),
  max: z.number().nullable().optional(),
  mean: z.number().nullable().optional(),
  // `.nullish()` not `.nullable()` — a legacy sidecar OMITS the key
  // entirely (undefined), a new one with <2 Good cells sends null. Both
  // must parse, and both mean "nothing to show" to the table.
  median: z.number().nullish(),
  std: z.number().nullish(),
  drift: z.number().nullish(),
  percentiles: z.record(z.string(), z.number()).nullish(),
  cleaned: z.boolean(),
});
/**
 * apps/python `schemas.preprocess.ColumnStatsResponse` (DS-LAKE-005B-A-T07).
 * No request DTO — the route takes only path params (dataset/artifact id),
 * same as `/metadata` and `/tags`; the sidecar this reads has nothing to
 * page through (8,000 tags costs the same one object download as one).
 */
export const PythonColumnStatsSchema = z.object({
  source_key: z.string(),
  column_stats_key: z.string(),
  stats: z.record(z.string(), TagColumnStatsSchema),
});

/**
 * apps/python `schemas.preprocess.FeatureSpecResponse` (DS-LAKE-025-T06).
 * No request DTO, same reasoning as `PythonColumnStatsSchema` directly above.
 *
 * `spec` is `passthrough()` rather than a modelled shape, mirroring Python's
 * own decision to type it `dict[str, Any]`: `feature_spec.json` is a
 * VERSIONED document (`featureVersion`) whose fields widen over time, and a
 * strict schema here would reject a legacy sidecar that reads perfectly
 * well. Only `scalingParams` is pinned, because that is the one field this
 * endpoint exists to serve (T06 read 3) — and it is `.optional()` because an
 * artifact written before DS-LAKE-018-T02 has none.
 *
 * Each entry is the params its scaler actually FIT: `{min,max}` for minmax,
 * `{mean,std}` for standard, `{median,iqr}` for robust. Kept as a loose
 * record of numbers rather than a union of those three — the method lives in
 * `spec.scaling`, and pairing them is the CALLER's job (`inverseScale`),
 * not this parse's.
 */
export const PythonFeatureSpecSchema = z.object({
  source_key: z.string(),
  feature_spec_key: z.string(),
  spec: z
    .object({
      scalingParams: z
        .record(z.string(), z.record(z.string(), z.number()))
        .optional(),
    })
    .passthrough(),
});

/**
 * apps/python `schemas.preprocess.CorrelationResponse` (DS-LAKE-005B-D-T05b).
 * CORRECTED (this session, live-caught): the prior version of this schema
 * (`correlation_matrix`/`resolved_tags`/`sample_rows`/`start_time`/
 * `end_time`) matched none of Python's actual response fields — `.parse()`
 * threw a ZodError on every real call, so `/correlation` was broken end to
 * end since it shipped. Field names/shapes below are read directly off
 * `CorrelationResponse` in `apps/python/schemas/preprocess.py`, not guessed:
 * `matrix` is `list[list[float]]` (positionally indexed, NOT a `tags`-keyed
 * record), and Python never sends `sample_rows`/`start_time`/`end_time` on
 * this response at all. The client's `DraftCorrelationResult`
 * (`services/dataset-draft.ts`) was already built against this correct
 * shape — only this schema was stale.
 */
export const PythonCorrelationSchema = z.object({
  source_key: z.string(),
  tags: z.array(z.string()),
  matrix: z.array(z.array(z.number())),
  column_metrics: z.record(z.string(), z.string()),
  insufficient_tags: z.array(z.string()),
  near_constant_tags: z.array(z.string()),
  total_candidates: z.number().int(),
});

const PreviewCellSchema = z.object({
  value: z.number(),
  status: z.enum(['Good', 'Bad', 'Questionable']),
});

const PreviewRowSchema = z.object({
  timestamp: z.string(),
  cells: z.record(z.string(), PreviewCellSchema),
});

/** apps/python `schemas.preprocess.RowsResponse`. */
export const PythonRowsSchema = z.object({
  source_key: z.string(),
  /**
   * The whole FILTERED view (start_time/end_time applied), not the raw
   * artifact and not this page — the client pages against it. `filtered` and
   * the resolved range below are what let a caller tell "6 rows total" from
   * "6 rows in this window of 5,000" (DS-LAKE-005B-A-T02).
   */
  total_row_count: z.number().int().nonnegative(),
  offset: z.number().int().nonnegative(),
  tags: z.array(z.string()),
  filtered: z.boolean(),
  start_time: z.string().nullable(),
  end_time: z.string().nullable(),
  rows: z.array(PreviewRowSchema),
});

const ColumnStatsSchema = z.object({
  tag: z.string(),
  /** TOTAL rows, INCLUDING missing — usable observations are count - missing. */
  count: z.number().int(),
  missing: z.number().int(),
  missing_pct: z.number(),
  min: z.number().nullable(),
  max: z.number().nullable(),
  mean: z.number().nullable(),
  median: z.number().nullable(),
  std: z.number().nullable(),
  /**
   * Same points/method as TagColumnStatsSchema.percentiles — this side is
   * the "recompute under current rules" mode (DS-LAKE-005B-B-T01, edit 3):
   * computed over whatever operations THIS preview just applied, not a
   * committed-artifact-time snapshot. Lenient (`.optional()`), matching this
   * schema's sibling fields per T04's own documented reasoning: before/
   * after/delta is preview's critical payload, this is supplementary.
   */
  percentiles: z.record(z.string(), z.number()).nullable().optional(),
});

const PreviewSideSchema = z.object({
  row_count: z.number().int(),
  column_count: z.number().int(),
  missing_cells: z.number().int(),
  missing_pct: z.number(),
  columns: z.array(ColumnStatsSchema),
  rows: z.array(PreviewRowSchema),
  /**
   * DS-LAKE-005B-A-T06. `series` is a SEPARATE, larger payload from `rows`
   * above (up to `maxPoints`, spanning the full window) — not a replacement.
   * Lenient like `PythonPreviewSchema`'s own T04 fields, for the same
   * reason: `before`/`after`/`delta` is preview's critical payload, and an
   * old connector missing these should not 500 an otherwise-valid preview.
   */
  downsampled: z.boolean().default(false),
  downsample_ratio: z.number().nullable().optional(),
  series: z.array(PreviewRowSchema).nullable().optional(),
});

/** apps/python `schemas.preprocess.PreviewResponse`. */
export const PythonPreviewSchema = z.object({
  source_key: z.string(),
  sampled: z.boolean(),
  sampled_rows: z.number().int(),
  source_row_count: z.number().int(),
  before: PreviewSideSchema,
  after: PreviewSideSchema,
  delta: z.object({
    row_count: z.number().int(),
    column_count: z.number().int(),
    missing_cells: z.number().int(),
    missing_pct: z.number(),
  }),
  /**
   * True when startTime/endTime narrowed the window (DS-LAKE-005B-A-T04).
   *
   * Deliberately LENIENT (`.default()`/`.optional()`), unlike
   * `PythonRowsSchema.filtered` (required, no default): a rows page IS its
   * `filtered`/count contract — a client cannot page correctly without it,
   * so an old connector missing the field should fail loudly. A preview's
   * critical payload is `before`/`after`/`delta`; `filtered` and the window
   * bounds are supplementary annotation on top of it, worth tolerating a
   * rolling-deploy gap on rather than 500ing a preview that otherwise parsed
   * fine.
   */
  filtered: z.boolean().default(false),
  start_time: z.string().nullable().optional(),
  end_time: z.string().nullable().optional(),
  /** Echoes the request's maxPoints (DS-LAKE-005B-A-T06); null when unset. */
  max_points: z.number().int().nullable().optional(),
  /**
   * The SAME edges both `before.series` and `after.series` were bucketed
   * against — computed once, reused for both sides regardless of each
   * side's own row count, so a diff can only come from the operations.
   */
  bucket_edges: z.array(z.string()).nullable().optional(),
  warnings: z.array(z.string()),
});

/** apps/python `schemas.preprocess.CleanupResponse`. */
export const PythonCleanupSchema = z.object({
  prefix: z.string(),
  deleted: z.number().int().nonnegative(),
});

/**
 * apps/python `schemas.preprocess.MetadataResponse` (DS-LAKE-005B-A-T01).
 *
 * `rowCount`, `tagCount`, `missingPct`, `checksum` and `createdAt` are already
 * on the DatasetArtifact row and are served without this call. `tags` and the
 * time range are the only things only the frame itself can answer.
 */
export const PythonMetadataSchema = z.object({
  source_key: z.string(),
  tags: z.array(z.string()),
  /** PHYSICAL width (2N+1 for N logical tags), measured — see schemas.preprocess.MetadataResponse. */
  column_count: z.number().int().nonnegative(),
  row_count: z.number().int().nonnegative(),
  start_time: z.string().nullable(),
  end_time: z.string().nullable(),
});

/**
 * apps/python `schemas.preprocess.ArtifactAdoptResponse` (DS-LAKE-025).
 *
 * The keys Save writes back onto the adopted `DatasetArtifact` rows, so a
 * saved dataset stops pointing at `drafts/{draftId}/...` for the rest of its
 * life. The three sidecar fields are nullable for the same reason their
 * columns are: an artifact that never had a feature spec or a validation
 * report has no key to record.
 */
export const PythonArtifactAdoptSchema = z.object({
  source_prefix: z.string(),
  destination_prefix: z.string(),
  object_key: z.string(),
  feature_spec_key: z.string().nullable(),
  validation_key: z.string().nullable(),
  column_stats_key: z.string().nullable(),
  keys: z.array(z.string()),
});

/**
 * apps/python `schemas.preprocess.HistogramResponse` (DS-LAKE-005B-D-T01).
 * `domain_min`/`domain_max` are `null` together when no requested tag
 * qualifies (fewer than 2 Good values) — never independently null, since the
 * domain is one shared value across every qualifying tag, not per-tag.
 */
const PythonKdePointSchema = z.object({
  x: z.number(),
  y: z.number(),
});

const PythonTagHistogramSchema = z.object({
  tag: z.string(),
  mean: z.number(),
  median: z.number(),
  mode: z.number(),
  std: z.number(),
  min: z.number(),
  max: z.number(),
  range: z.number(),
  count: z.number().int().nonnegative(),
  kde: z.array(PythonKdePointSchema),
});

export const PythonHistogramSchema = z.object({
  source_key: z.string(),
  domain_min: z.number().nullable(),
  domain_max: z.number().nullable(),
  tags: z.array(PythonTagHistogramSchema),
  insufficient_tags: z.array(z.string()),
});

/**
 * apps/python `schemas.preprocess.BoxplotResponse` (DS-LAKE-005B-D-T03).
 * `outliers` is CAPPED at the request's `outlierCap`; `outlier_count` always
 * carries the true, uncapped total — `outliers.length < outlier_count`
 * means the list was truncated.
 */
const PythonTagBoxplotSchema = z.object({
  tag: z.string(),
  min: z.number(),
  q1: z.number(),
  median: z.number(),
  mean: z.number(),
  q3: z.number(),
  max: z.number(),
  whisker_low: z.number(),
  whisker_high: z.number(),
  outliers: z.array(z.number()),
  outlier_count: z.number().int().nonnegative(),
  count: z.number().int().nonnegative(),
});

export const PythonBoxplotSchema = z.object({
  source_key: z.string(),
  tags: z.array(PythonTagBoxplotSchema),
  /** Requested tags with 0 Good values in this window. Gated on
   * `count > 0` server-side — NOT the client's `hasData` check
   * (`min != max or median != 0`), which would mislabel an all-zero-
   * valued tag as insufficient (`boxplot_service.py::qualifies`). */
  insufficient_tags: z.array(z.string()),
});

/**
 * apps/python `schemas.preprocess.SplitStatsResponse` (MODEL-FLOW-014-T03).
 * `train`/`test` are `BoxplotResponse`-shaped (minus `source_key`, which
 * belongs once at the top) so the client's existing `TagBoxplotChart`
 * renders either side with no translation layer.
 */
const PythonSplitStatsSideSchema = z.object({
  tags: z.array(PythonTagBoxplotSchema),
  insufficient_tags: z.array(z.string()),
});

export const PythonSplitStatsSchema = z.object({
  source_key: z.string(),
  target_y: z.string(),
  split_ratio: z.number(),
  /** The resolved cut, ECHOED back — the client never derives it. The
   * FIRST TEST ROW's timestamp (train = strictly before, test = at or
   * after), matching `train.py::chronological_split`'s own convention. */
  cut_timestamp: z.string(),
  train_labelled_rows: z.number().int().nonnegative(),
  test_labelled_rows: z.number().int().nonnegative(),
  source_rows: z.number().int().nonnegative(),
  train: PythonSplitStatsSideSchema,
  test: PythonSplitStatsSideSchema,
});

const PythonScatterPointSchema = z.object({
  x: z.number(),
  y: z.number(),
});

/**
 * apps/python `schemas.preprocess.ScatterResponse` (DS-LAKE-005B-D-T04).
 * `points` is DECIMATED (2D grid binning, not LTTB — a scatter's axes are
 * tag values, not time) for plotting only; `n`/`slope`/`intercept`/`r2`
 * are always computed over the FULL Good-filtered frame, never the
 * decimated sample. A pair counts toward `n` only when BOTH x and y are
 * Good — a deliberate divergence from the client's status-blind
 * `toScatterPoints` (`lib/preprocessing.ts`), which this endpoint does
 * not port; `toScatterPoints` itself is untouched because it also backs
 * Model Creation Flow evaluation metrics.
 */
export const PythonScatterSchema = z.object({
  source_key: z.string(),
  x_tag: z.string(),
  y_tag: z.string(),
  points: z.array(PythonScatterPointSchema),
  n: z.number().int().nonnegative(),
  slope: z.number(),
  intercept: z.number(),
  r2: z.number(),
  downsampled: z.boolean(),
});

/** apps/python `schemas.preprocess.TagCatalogResponse` (DS-LAKE-005B-A-T03). */
export const PythonTagCatalogSchema = z.object({
  source_key: z.string(),
  /** Tags matching `search`, not the artifact's full tag count. */
  total_count: z.number().int().nonnegative(),
  offset: z.number().int().nonnegative(),
  search: z.string().nullable(),
  tags: z.array(z.string()),
});
