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
});

export const StartCleanJobSchema = z.object({
  operations: z.array(CleaningOperationSchema).min(1),
  /** Per-tag decimal places; Python cannot see the client's tagMeta. */
  precision: z.record(z.string(), z.number().int()).default({}),
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

export class CreateRawVersionDto extends createZodDto(CreateRawVersionSchema) {}
export class StartCleanJobDto extends createZodDto(StartCleanJobSchema) {}
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
});

export type ArtifactStats = z.infer<typeof ArtifactStatsSchema>;

const TagColumnStatsSchema = z.object({
  tag: z.string(),
  coverage: z.number(),
  null_pct: z.number(),
  outlier_count: z.number().int().nonnegative(),
  min: z.number().nullable(),
  max: z.number().nullable(),
  mean: z.number().nullable(),
  drift: z.number().nullable(),
  /**
   * p1/p5/p10/p20/p80/p90/p95/p99 (DS-LAKE-005B-B-T01, edit 3) — a
   * value-clip bound needs the FULL artifact's percentiles, not one computed
   * from whatever viewport window happens to be in browser state. Nullable
   * (not optional): Python always sends the key, `null` when there are no
   * Good cells to compute it from.
   */
  percentiles: z.record(z.string(), z.number()).nullable(),
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

/** apps/python `schemas.preprocess.TagCatalogResponse` (DS-LAKE-005B-A-T03). */
export const PythonTagCatalogSchema = z.object({
  source_key: z.string(),
  /** Tags matching `search`, not the artifact's full tag count. */
  total_count: z.number().int().nonnegative(),
  offset: z.number().int().nonnegative(),
  search: z.string().nullable(),
  tags: z.array(z.string()),
});
