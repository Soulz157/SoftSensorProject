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
  limit: z.coerce.number().int().min(1).max(50_000).default(1_000),
});

export const PreviewVersionSchema = z.object({
  operations: z.array(CleaningOperationSchema).default([]),
  precision: z.record(z.string(), z.number().int()).default({}),
  sampleRows: z.number().int().min(1).max(50_000).optional(),
  previewRows: z.number().int().min(1).max(200).optional(),
});

export class CreateRawVersionDto extends createZodDto(CreateRawVersionSchema) {}
export class StartCleanJobDto extends createZodDto(StartCleanJobSchema) {}
export class ListRowsDto extends createZodDto(ListRowsSchema) {}
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
});

export type ArtifactStats = z.infer<typeof ArtifactStatsSchema>;

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
  /** The whole artifact, not this page — the client pages against it. */
  total_row_count: z.number().int().nonnegative(),
  offset: z.number().int().nonnegative(),
  tags: z.array(z.string()),
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
});

const PreviewSideSchema = z.object({
  row_count: z.number().int(),
  column_count: z.number().int(),
  missing_cells: z.number().int(),
  missing_pct: z.number(),
  columns: z.array(ColumnStatsSchema),
  rows: z.array(PreviewRowSchema),
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
  warnings: z.array(z.string()),
});

/** apps/python `schemas.preprocess.CleanupResponse`. */
export const PythonCleanupSchema = z.object({
  prefix: z.string(),
  deleted: z.number().int().nonnegative(),
});
