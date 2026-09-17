/**
 * MODEL-SERVE-005-T02. Compare live input distributions against the
 * distribution a model was actually trained on — pure functions, no I/O.
 * The caller resolves both inputs: `poolFeatureStats` combines the
 * `PredictionLog.featureStats` Json blobs a time-range query returns;
 * `computeDrift` compares the pooled result against `column_stats.json`
 * (read via `postToPython`, the same sidecar `getArtifactColumnStatsService`
 * already serves — see prediction-log.authorized.service.ts).
 *
 * The comparison runs in MODEL-READY (scaled) units, matching what
 * `column_stats.json` actually holds for a FINAL artifact — verified live
 * against a real sidecar (MODEL-SERVE-005's plan): FINAL inherits its
 * columnStatsKey from the GOLD its source produced, and GOLD's stats are
 * built on the SCALED frame. `apps/serving` already computes its aggregates
 * over the same scaled frame `to_model_ready` produces, so no unscaling
 * happens anywhere in this path.
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
 *  a drift comparison needs. `std`/`median` were, until this feature,
 *  silently stripped from the wire by an undeclared response-model field —
 *  fixed in schemas/preprocess.py; this type assumes the fix is live. */
export interface ColumnBaseline {
  mean: number | null;
  std: number | null;
  percentiles: { p1?: number; p99?: number } | null;
}

export type ColumnBaselineMap = Record<string, ColumnBaseline>;

export interface DriftThresholds {
  warnSd: number;
  criticalSd: number;
  outOfRangePct: number;
}

export type DriftStatus = 'OK' | 'WARN' | 'CRITICAL' | 'UNKNOWN';

export interface ColumnDrift {
  column: string;
  n: number;
  liveMean: number;
  liveStd: number;
  trainMean: number | null;
  trainStd: number | null;
  /** (liveMean - trainMean) / trainStd. Null when trainStd is null/<=0 —
   *  an unknown or degenerate baseline is never treated as "no drift". */
  z: number | null;
  /** ESTIMATED, not counted — see the module doc and `estimateOutOfRangePct`.
   *  Null when the baseline carries no p1/p99 (a legacy sidecar, or a
   *  column with no Good cells at training time). */
  outOfRangePct: number | null;
  status: DriftStatus;
  reason?: string;
}

export interface DriftReport {
  status: DriftStatus;
  columns: ColumnDrift[];
}

/**
 * Combine N requests' worth of per-column sufficient statistics into one.
 * `n`/`sum`/`sumsq` add; `min`/`max` take the extreme. A column absent from
 * some inputs (should not happen in steady operation — every logged request
 * scores the same feature set) is simply skipped for those inputs rather
 * than treated as zero, which would silently pull the pooled mean toward
 * zero.
 */
export function poolFeatureStats(inputs: FeatureStatsMap[]): FeatureStatsMap {
  const pooled: FeatureStatsMap = {};
  for (const input of inputs) {
    for (const [column, agg] of Object.entries(input)) {
      if (!agg || agg.n <= 0) continue;
      const existing = pooled[column];
      pooled[column] = existing
        ? {
            n: existing.n + agg.n,
            sum: existing.sum + agg.sum,
            sumsq: existing.sumsq + agg.sumsq,
            min: Math.min(existing.min, agg.min),
            max: Math.max(existing.max, agg.max),
          }
        : { ...agg };
    }
  }
  return pooled;
}

/** Abramowitz & Stegun 7.1.26 — |error| <= 1.5e-7, plenty for a monitoring
 *  signal. No dependency pulled in for one function. */
function erf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;
  const t = 1 / (1 + p * ax);
  const y =
    1 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-ax * ax);
  return sign * y;
}

function normalCdf(x: number, mean: number, std: number): number {
  if (!(std > 0)) return x < mean ? 0 : x > mean ? 1 : 0.5;
  return 0.5 * (1 + erf((x - mean) / (std * Math.SQRT2)));
}

/**
 * P(X < p1) + P(X > p99), estimated by modelling the LIVE population as
 * Normal(liveMean, liveStd) and evaluating it at the TRAINING baseline's
 * p1/p99 bounds. This is an ESTIMATE, not a per-value count: PredictionLog
 * stores sufficient statistics, not raw values, so an exact "share of live
 * values outside [p1,p99]" would need either every raw value (defeats the
 * point of aggregating) or a running histogram (not part of this schema).
 * `column_stats.json`'s own percentiles are computed empirically, not
 * parametrically — this estimate can disagree with a true empirical rate
 * for a skewed distribution, which is why the report always publishes
 * `z` (exact) alongside this (estimated), never this alone.
 */
export function estimateOutOfRangePct(
  liveMean: number,
  liveStd: number,
  p1: number,
  p99: number,
): number {
  const below = normalCdf(p1, liveMean, liveStd);
  const above = 1 - normalCdf(p99, liveMean, liveStd);
  return Math.max(0, Math.min(100, (below + above) * 100));
}

function statusFor(
  absZ: number | null,
  outOfRangePct: number | null,
  thresholds: DriftThresholds,
): DriftStatus {
  if (absZ === null) return 'UNKNOWN';
  if (absZ >= thresholds.criticalSd) return 'CRITICAL';
  if (
    absZ >= thresholds.warnSd ||
    (outOfRangePct !== null && outOfRangePct >= thresholds.outOfRangePct)
  ) {
    return 'WARN';
  }
  return 'OK';
}

/** Severity order for rolling per-column statuses into one report status —
 *  UNKNOWN never masks a worse KNOWN status found on another column. */
const SEVERITY: Record<DriftStatus, number> = {
  UNKNOWN: 0,
  OK: 1,
  WARN: 2,
  CRITICAL: 3,
};

/**
 * The comparison. Iterates `live`'s OWN columns, never the baseline's — a
 * baseline tag with no live counterpart (verified live: the sidecar for a
 * real FINAL artifact carries the TARGET tag alongside every feature) is
 * simply not compared, neither UNKNOWN nor a gap.
 */
export function computeDrift(
  live: FeatureStatsMap,
  baseline: ColumnBaselineMap,
  thresholds: DriftThresholds,
): DriftReport {
  const columns: ColumnDrift[] = [];

  for (const [column, agg] of Object.entries(live)) {
    const liveMean = agg.sum / agg.n;
    const liveVariance = Math.max(0, agg.sumsq / agg.n - liveMean * liveMean);
    const liveStd = Math.sqrt(liveVariance);

    const base = baseline[column];
    const trainMean = base?.mean ?? null;
    const trainStd = base?.std ?? null;

    if (trainMean === null || trainStd === null || !(trainStd > 0)) {
      columns.push({
        column,
        n: agg.n,
        liveMean,
        liveStd,
        trainMean,
        trainStd,
        z: null,
        outOfRangePct: null,
        status: 'UNKNOWN',
        reason: !base
          ? 'no training baseline for this column'
          : 'training std unavailable or zero',
      });
      continue;
    }

    const z = (liveMean - trainMean) / trainStd;
    const p1 = base.percentiles?.p1;
    const p99 = base.percentiles?.p99;
    const outOfRangePct =
      p1 !== undefined && p99 !== undefined
        ? estimateOutOfRangePct(liveMean, liveStd, p1, p99)
        : null;

    columns.push({
      column,
      n: agg.n,
      liveMean,
      liveStd,
      trainMean,
      trainStd,
      z,
      outOfRangePct,
      status: statusFor(Math.abs(z), outOfRangePct, thresholds),
    });
  }

  const overall = columns.reduce<DriftStatus>(
    (worst, c) => (SEVERITY[c.status] > SEVERITY[worst] ? c.status : worst),
    'UNKNOWN',
  );

  return { status: overall, columns };
}

/** One dense bucket's verdict, before the consecutive-breach rule runs. */
export interface DriftBucket {
  /** Bucket start, for ordering and for naming when a breach began. */
  at: string;
  report: DriftReport;
}

export interface SustainedColumnDrift extends ColumnDrift {
  /** How many consecutive most-recent buckets breached at this column's own
   *  level. 0 when the newest bucket did not breach. */
  consecutive: number;
  /** The status the raw newest bucket reported, BEFORE the rule. Kept so a
   *  reader can see a breach that is real but not yet sustained, rather
   *  than a signal that silently says OK while z sits above the line. */
  instantStatus: DriftStatus;
  /** Bucket start of the oldest breach in the current run — null when the
   *  newest bucket did not breach. */
  since: string | null;
}

export interface SustainedDriftReport {
  status: DriftStatus;
  columns: SustainedColumnDrift[];
  /** The rule in force, echoed so a caller never has to guess which
   *  threshold produced the status it is rendering. */
  consecutiveRequired: number;
  bucketsEvaluated: number;
}

/**
 * MODEL-SERVE-008-T03. Require N CONSECUTIVE dense buckets to breach before
 * the drift signal changes state.
 *
 * WHY THIS EXISTS. `warnSd`/`criticalSd` were chosen against HOURLY windows.
 * Evaluated every ten minutes against the same unchanged process, the same
 * numbers fire roughly six times as often — so the cadence would silently
 * change the effective sensitivity, which is exactly what this feature's
 * openDecisions[3] refused to let happen by accident. The thresholds keep
 * their meaning; what changes is how much evidence a state change needs.
 * REJECTED (recorded here rather than only in the ledger): separate
 * warnSd/criticalSd for the dense signal — two numbers per schedule that
 * can silently disagree about one process; and reusing the thresholds
 * unchanged — simplest, and the accidental-sensitivity change itself.
 *
 * UNKNOWN NEVER FOLDS INTO OK, AND IS NEVER "NOT A BREACH". A column whose
 * baseline is missing or degenerate has NO verdict; the rule cannot count
 * it toward a breach run and must not silently report it as healthy. It
 * propagates as UNKNOWN, the rule that `computeDrift` already holds and
 * that prediction-drift.spec.ts already pins — a new call site is a new
 * place to break it.
 *
 * ONE UNKNOWN COLUMN NEVER MASKS ANOTHER'S CRITICAL: the report status is
 * the worst REAL verdict present, with UNKNOWN surfacing only when nothing
 * worse was found.
 *
 * `buckets` are oldest-first. The rule reads from the NEWEST backwards,
 * because the question is "is this breach sustained right now", never "was
 * there ever a run of breaches in this range".
 */
export function applyConsecutiveBreachRule(
  buckets: DriftBucket[],
  consecutiveRequired: number,
): SustainedDriftReport {
  const required = Math.max(1, Math.floor(consecutiveRequired));
  if (buckets.length === 0) {
    return {
      status: 'UNKNOWN',
      columns: [],
      consecutiveRequired: required,
      bucketsEvaluated: 0,
    };
  }

  const newest = buckets[buckets.length - 1]!;
  const columns: SustainedColumnDrift[] = newest.report.columns.map((col) => {
    const instantStatus = col.status;

    // No verdict to sustain. UNKNOWN passes straight through with an empty
    // run — counting it as a non-breach would let a missing baseline read
    // as evidence of health.
    if (instantStatus === 'UNKNOWN') {
      return { ...col, consecutive: 0, instantStatus, since: null };
    }
    if (instantStatus === 'OK') {
      return { ...col, consecutive: 0, instantStatus, since: null };
    }

    // Walk backwards while each bucket breached AT LEAST as hard as the
    // newest one. A WARN preceded by CRITICALs is still a sustained WARN;
    // a CRITICAL preceded by WARNs is not yet a sustained CRITICAL, which
    // is the conservative direction.
    const floor = SEVERITY[instantStatus];
    let consecutive = 0;
    let since: string | null = null;
    for (let i = buckets.length - 1; i >= 0; i -= 1) {
      const bucket = buckets[i]!;
      const match = bucket.report.columns.find((c) => c.column === col.column);
      if (!match || match.status === 'UNKNOWN') break;
      if (SEVERITY[match.status] < floor) break;
      consecutive += 1;
      since = bucket.at;
    }

    // Under the bar: the breach is REAL and is reported as `instantStatus`,
    // but the acted-on status stays OK. Hiding the instant verdict would
    // make the panel say OK while z sits above the line, which is the same
    // confident-wrong-answer this ledger keeps refusing.
    const status: DriftStatus = consecutive >= required ? instantStatus : 'OK';
    return {
      ...col,
      status,
      consecutive,
      instantStatus,
      since: consecutive > 0 ? since : null,
    };
  });

  // Reuses this module's OWN severity scale and its reduce convention
  // (UNKNOWN 0 < OK 1 < WARN 2 < CRITICAL 3, seeded at UNKNOWN) rather
  // than defining a second one: one UNKNOWN column cannot mask another's
  // CRITICAL, and an all-UNKNOWN report stays UNKNOWN instead of
  // collapsing to OK. A second scale here is a second thing to disagree
  // with `computeDrift`.
  const worst = columns.reduce<DriftStatus>(
    (acc, c) => (SEVERITY[c.status] > SEVERITY[acc] ? c.status : acc),
    'UNKNOWN',
  );

  return {
    status: worst,
    columns,
    consecutiveRequired: required,
    bucketsEvaluated: buckets.length,
  };
}
