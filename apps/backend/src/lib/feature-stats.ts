/**
 * Per-column sufficient statistics a window or request records, and the
 * training baseline they are compared against. Pure types, no I/O.
 *
 * MODEL-SERVE-028. These lived in `prediction-drift.ts` alongside the
 * z-score mean-shift drift verdict. That verdict was removed (PSI is now the
 * only input-drift signal), but frozen-sensor detection (`sensor-frozen.ts`)
 * still reads `featureStats` against `column_stats.json`, so the shapes
 * outlive it here.
 */

/** Sufficient statistics for one column over some population — enough to
 *  compute an EXACT pooled mean/variance across many requests without ever
 *  re-reading the underlying rows. `{n:0}` is a legal "no data" value. */
export interface ColumnAggregate {
  n: number;
  sum: number;
  sumsq: number;
  min: number;
  max: number;
}

export type FeatureStatsMap = Record<string, ColumnAggregate>;

/** The subset of a `TagColumnStats` entry (apps/python schemas/preprocess.py)
 *  a baseline comparison needs. */
export interface ColumnBaseline {
  mean: number | null;
  std: number | null;
  percentiles: { p1?: number; p99?: number } | null;
}

export type ColumnBaselineMap = Record<string, ColumnBaseline>;
