import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/**
 * MODEL-SERVE-005-T01/T02. `{n, sum, sumsq, min, max}` — sufficient
 * statistics for one model-ready column, computed by apps/serving over
 * every row of ONE request (not the capped subset written to Parquet).
 * `n` may be 0 for a column that legitimately had no values in this
 * request — never omitted, so a pooled read can distinguish "zero
 * contribution" from "column not scored at all".
 */
const ColumnAggregateSchema = z
  .object({
    n: z.number().int().min(0),
    sum: z.number(),
    sumsq: z.number(),
    min: z.number(),
    max: z.number(),
  })
  .strict();

const PredictionLogRowSchema = z
  .object({
    // Raw (engineering-unit) values only — see PredictionLogRow's own doc
    // comment in apps/python schemas/preprocess.py for why.
    features: z.record(z.string(), z.number()),
    prediction: z.number(),
  })
  .strict();

/**
 * MODEL-SERVE-005-T01. The whole ingest body from apps/serving.
 *
 * Deliberately carries BOTH the capped raw rows (for the Parquet object)
 * and the full-population aggregates (for Postgres) — apps/serving already
 * has all of the request's rows and the model-ready frame in memory when
 * it computes `featureStats`/`predictionStats`, and sending the exact
 * aggregates here is cheaper and more honest than the backend trying to
 * reconstruct them from a subset.
 */
export const IngestPredictionLogSchema = z
  .object({
    modelId: z.string().uuid(),
    modelVersionId: z.string().uuid(),
    requestedAt: z.string().datetime(),
    // Rows in the ORIGINAL /predict request — may exceed rows.length when
    // SERVING_LOG_MAX_ROWS trimmed the detail written to the object.
    rowCount: z.number().int().positive(),
    loggedRows: z.number().int().min(0),
    samplingRate: z.number().min(0).max(1),
    // Can be empty: a sampled-in request whose cap trims to 0 detail rows
    // still carries real aggregates and is still worth a PredictionLog
    // row — see the service's own objectKey:null path.
    rows: z.array(PredictionLogRowSchema),
    featureStats: z.record(z.string(), ColumnAggregateSchema),
    predictionStats: ColumnAggregateSchema,
  })
  .strict()
  .refine((body) => body.rows.length === body.loggedRows, {
    message: 'rows.length must equal loggedRows',
    path: ['rows'],
  });

export class IngestPredictionLogDto extends createZodDto(
  IngestPredictionLogSchema,
) {}

/**
 * MODEL-SERVE-005. Shared by GET .../predictions and GET .../drift — both
 * read PredictionLog over the same [from, to] window, just aggregated
 * differently.
 */
export const PredictionLogRangeQuerySchema = z
  .object({
    from: z.string().datetime(),
    to: z.string().datetime(),
  })
  .strict()
  .refine((q) => new Date(q.from).getTime() <= new Date(q.to).getTime(), {
    message: '`from` must not be after `to`',
    path: ['from'],
  });

export class PredictionLogRangeQueryDto extends createZodDto(
  PredictionLogRangeQuerySchema,
) {}
