/**
 * MODEL-SERVE-046 (replacing MODEL-SERVE-012-T03's spread ratio).
 * THE OUTPUT-ERROR AXIS of model health, graded PER POINT.
 *
 * Every other health signal watches the model's INPUTS or its PLUMBING:
 * `SOURCE_UNREACHABLE`/`STALE`/`NO_PREDICTIONS` say the schedule is not
 * delivering, `BAD_DATA`/`SENSOR_FROZEN` say the readings are wrong, and
 * `DRIFT_*` says the feature distribution has moved. None of them looks at
 * whether the model is still RIGHT. This axis does.
 *
 * THE RULE: take the worst single residual among the joined (predicted,
 * actual) pairs of the LATEST 24 HOURS of joined windows and divide it by the
 * model's reference residual SD (`lib/model-version-residual-sd.ts`, the
 * run's own test-split SD). Beyond `warnSd` x SD is a WARNING; beyond
 * `criticalSd` x SD is an ALERT (defaults 2 and 3) — the same +/-2 SD and
 * +/-3 SD guard lines the Residual chart draws, so the pill and the chart
 * cannot disagree about what "outside the band" means.
 *
 * WHY THE EXTREME IS STORED PER WINDOW. `InferenceWindowTruth` keeps pooled
 * SUMS, which can grade a spread but not whether ONE point fell outside a
 * band; the individual residuals live in object storage behind `pairsKey`,
 * and reading those per window per model on the list endpoint is what the
 * earlier design rejected. The join already holds every residual in memory,
 * so it records the window's `maxAbsResidual` once, and this axis reads it
 * with a grouped aggregate — no object read.
 *
 * WHY "LATEST 24 H" IS ANCHORED TO THE NEWEST JOINED WINDOW, NOT TO NOW. A
 * residual needs a MEASURED lab actual, and the join only runs once a
 * window is `truthLagMinutes` old (a day, for a daily lab). A cut at
 * `now - 24h` would therefore be empty by construction and the axis would
 * report UNKNOWN forever. Anchoring to the newest joined window keeps
 * "the latest day of evidence" meaningful, and `RESIDUAL_POINT_STALE_HOURS`
 * stops a stale verdict outliving its evidence.
 *
 * Sign convention: `live-error.ts` uses `residual = predicted - actual`; only
 * the magnitude is used here.
 */
export type ResidualSdStatus = 'UNKNOWN' | 'OK' | 'WARN' | 'ALERT';

export interface ResidualPointWindow {
  windowStart: Date;
  /** Joined pairs in the window. A window with `n <= 0` carries no evidence. */
  n: number;
  /** The window's worst single |predicted - actual|. */
  maxAbsResidual: number;
}

export interface ResidualSdVerdict {
  status: ResidualSdStatus;
  /** Worst single |residual| in the judged span. Null when none. */
  worstAbsResidual: number | null;
  /** `worstAbsResidual / baselineSd` — how many SDs out the worst point is.
   *  Null whenever the verdict is UNKNOWN. */
  ratio: number | null;
  /** What the figure was measured against: JOINED lab pairs, or — only while
   *  none exists — the last reported lab value carried forward ('held', see
   *  `lib/held-deviation.ts`). Null when there is no evidence at all. */
  basis: 'pairs' | 'held' | null;
  /** The reference SD the ratio was taken against, echoed so a reader can
   *  see both halves of the comparison rather than one derived number. */
  baselineSd: number | null;
  /** Joined pairs behind the verdict — the sample size. */
  n: number;
}

export interface ResidualSdThresholds {
  /** Multiple of the reference SD beyond which a point is a WARNING. */
  warnSd: number;
  /** Multiple of the reference SD beyond which a point is an ALERT. */
  criticalSd: number;
}

/** How much joined history is judged, counted back from the newest joined
 *  window (see the header for why not from now). */
export const RESIDUAL_POINT_HOURS = 24;

/** Evidence older than this, measured from now, grades nothing. */
export const RESIDUAL_POINT_STALE_HOURS = 7 * 24;

/**
 * HOW FAR BACK joined windows are READ, in days — the query bound shared by
 * the detail page's `getHealthStatus` and the list's `deriveDeployStatuses`,
 * so the two badges grade the same model from the same sample. Wider than
 * the judged span on purpose: the 24 h cut is applied in memory off the
 * newest joined window, which needs those windows in hand.
 */
export const TRUTH_POOL_DAYS = 30;

/** The cutoff itself, so no caller re-derives the arithmetic. */
export function truthPoolSince(now: Date = new Date()): Date {
  return new Date(now.getTime() - TRUTH_POOL_DAYS * 24 * 60 * 60 * 1000);
}

const HOUR_MS = 60 * 60 * 1000;

/**
 * Grade a model's latest residuals against its reference SD.
 *
 * UNKNOWN — never OK — whenever the comparison cannot be made: no reference
 * SD, no joined pairs, or evidence gone stale. "We cannot tell" and "it is
 * fine" are different answers, and collapsing them is how a monitoring axis
 * goes quietly green on a model nobody is actually watching.
 *
 * There is no minimum sample: one point beyond 3 SD IS the evidence, unlike
 * a spread, which needs a sample to mean anything.
 */
export function classifyResidualPoints(input: {
  windows: readonly ResidualPointWindow[];
  /** From `baselineResidualSd` — null when the version has none. */
  baselineSd: number | null;
  thresholds: ResidualSdThresholds;
  /** Used ONLY when no joined pair exists. */
  heldFallback?: { worstAbsResidual: number } | null;
  now?: Date;
}): ResidualSdVerdict {
  const { baselineSd, thresholds } = input;
  const now = input.now ?? new Date();

  const unknown: ResidualSdVerdict = {
    status: 'UNKNOWN',
    worstAbsResidual: null,
    ratio: null,
    basis: null,
    baselineSd,
    n: 0,
  };

  const evidence = input.windows.filter(
    (w) => w.n > 0 && Number.isFinite(w.maxAbsResidual),
  );
  if (evidence.length === 0) {
    // No joined pair yet. Grade the held deviation instead, if there is one;
    // the moment a pair joins this branch is never taken again.
    const held = input.heldFallback;
    if (!held || !Number.isFinite(held.worstAbsResidual)) return unknown;
    if (baselineSd === null || !(baselineSd > 0)) {
      return { ...unknown, worstAbsResidual: held.worstAbsResidual };
    }
    const ratio = held.worstAbsResidual / baselineSd;
    return {
      status: statusFor(ratio, thresholds),
      worstAbsResidual: held.worstAbsResidual,
      ratio,
      basis: 'held',
      baselineSd,
      n: 0,
    };
  }

  const newest = Math.max(...evidence.map((w) => w.windowStart.getTime()));
  const recent = evidence.filter(
    (w) => w.windowStart.getTime() >= newest - RESIDUAL_POINT_HOURS * HOUR_MS,
  );
  const n = recent.reduce((sum, w) => sum + w.n, 0);
  const worstAbsResidual = Math.max(...recent.map((w) => w.maxAbsResidual));

  if (baselineSd === null || !(baselineSd > 0)) {
    return { ...unknown, worstAbsResidual, n };
  }
  if (now.getTime() - newest > RESIDUAL_POINT_STALE_HOURS * HOUR_MS) {
    return { ...unknown, worstAbsResidual, n };
  }

  const ratio = worstAbsResidual / baselineSd;
  return {
    status: statusFor(ratio, thresholds),
    worstAbsResidual,
    ratio,
    basis: 'pairs',
    baselineSd,
    n,
  };
}

/** Strictly BEYOND the multiple: a point exactly on the guard line is on the
 *  band, not outside it. */
function statusFor(
  ratio: number,
  thresholds: ResidualSdThresholds,
): ResidualSdStatus {
  return ratio > thresholds.criticalSd
    ? 'ALERT'
    : ratio > thresholds.warnSd
      ? 'WARN'
      : 'OK';
}
