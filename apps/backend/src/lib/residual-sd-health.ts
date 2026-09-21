import { computeLiveError, poolTruthStats, TruthStats } from './live-error';

/**
 * MODEL-SERVE-012-T03. THE OUTPUT-ERROR AXIS of model health.
 *
 * Every existing health signal watches the model's INPUTS or its PLUMBING:
 * `SOURCE_UNREACHABLE`/`STALE`/`NO_PREDICTIONS` say the schedule is not
 * delivering, `BAD_DATA`/`SENSOR_FROZEN` say the readings are wrong, and
 * `DRIFT_*` says the feature distribution has moved. None of them looks at
 * whether the model is still RIGHT. A model can fetch cleanly, from live
 * instruments, with un-drifted inputs, and be predicting badly — and until
 * this module that state rendered as a green pill.
 *
 * THE STATISTIC: `liveSd / baselineSd`, where the numerator is the residual
 * spread over recently joined pairs and the denominator is the run's own
 * test-split residual SD (`lib/model-version-residual-sd.ts`).
 *
 * WHY A RATIO AGAINST A FROZEN NUMBER, rather than "what share of points
 * fell outside the ±k·SD bands the chart draws". Two reasons, both load-
 * bearing:
 *
 *   1. A coverage share measured against an SD recomputed from the SAME
 *      residuals is scale-invariant. Multiply every live residual by ten —
 *      the model is now ten times worse — and the share outside its own 1 SD
 *      is unchanged. It would grade nothing.
 *   2. `InferenceWindowTruth` stores per-window SUMS, not individual
 *      residuals (those live in object storage behind `pairsKey`), so a true
 *      per-point count would mean an object read per window per model — on
 *      the list endpoint, for every model in the workspace. Counting window
 *      MEANS instead would not rescue it: the null spread of a mean of n
 *      residuals is baselineSd/√n, so with ~60 scored rows a window mean
 *      beyond 1·baselineSd is a ~7.7σ event and the Warning tier would be
 *      unreachable dead code.
 *
 * The pooled sums give the right statistic exactly, with no object read.
 *
 * THIS MODULE COMPUTES NO ERROR MATH. `poolTruthStats`/`computeLiveError`
 * own that, and the truth endpoint already serves their output; a second
 * formula here could drift from the figure shown for the same model on the
 * same screen. Same rule `heldEvalPoints` states on the client side.
 *
 * Sign convention, in case `bias` is ever surfaced from here: `live-error.ts`
 * uses `residual = predicted − actual`; the client's `lib/monitoring.ts` uses
 * the reverse. Irrelevant to `sd`, which is a spread.
 */
export type ResidualSdStatus = 'UNKNOWN' | 'OK' | 'WARN' | 'ALERT';

export interface ResidualSdVerdict {
  status: ResidualSdStatus;
  /** Pooled residual SD over the joined pairs. Null when there are none. */
  liveSd: number | null;
  /** `liveSd / baselineSd`. Null whenever the verdict is UNKNOWN. */
  ratio: number | null;
  /** The reference SD the ratio was taken against, echoed so a reader can
   *  see both halves of the comparison rather than one derived number. */
  baselineSd: number | null;
  /** Joined pairs behind the verdict — the sample size, rendered beside the
   *  verdict so a thin one is visible rather than implied. */
  n: number;
}

export interface ResidualSdThresholds {
  /** Ratio at or above which the spread is a WARNING. Same column
   *  `prediction-drift.ts` already reads as an SD multiple. */
  warnSd: number;
  /** Ratio at or above which it is an ALERT. */
  criticalSd: number;
}

/**
 * MINIMUM PAIRS before this axis may raise anything.
 *
 * A residual needs a MEASURED actual, so these pairs arrive at lab cadence —
 * roughly daily on this plant, not at scoring cadence (the client's
 * `residualDensityNote` states the same limit to the reader). An SD over a
 * handful of pairs is mostly noise, and a noisy numerator over a frozen
 * denominator would alarm on sampling luck. Thirty is the conventional bar
 * for treating a sample SD as informative at all; below it the honest answer
 * is UNKNOWN, which renders as "no evidence" and never as healthy.
 */
export const MIN_RESIDUAL_SD_PAIRS = 30;

/**
 * MODEL-SERVE-012-T08. HOW FAR BACK joined pairs are pooled from, in days.
 *
 * A TIME horizon, not a row count, and SHARED by both readers — the detail
 * page's `getHealthStatus` and the list's `deriveDeployStatuses`. That is the
 * point of it living here rather than beside either caller: the list can only
 * pool with a grouped aggregate (one query for every model, no per-model
 * fan-out) while the detail page selects rows, and a row-count `take` cannot
 * be expressed as a group-by bound at all. Two different bounds would mean
 * the badge on the list and the badge on the detail page could grade the same
 * model from different samples and disagree — the contradiction this whole
 * feature exists to remove.
 *
 * Thirty days because a residual needs a MEASURED lab actual and those
 * arrive at roughly daily cadence here, against a `MIN_RESIDUAL_SD_PAIRS` of
 * 30. A shorter horizon cannot accumulate the sample, so the axis would
 * report UNKNOWN forever.
 */
export const TRUTH_POOL_DAYS = 30;

/** The cutoff itself, so no caller re-derives the arithmetic. */
export function truthPoolSince(now: Date = new Date()): Date {
  return new Date(now.getTime() - TRUTH_POOL_DAYS * 24 * 60 * 60 * 1000);
}

/**
 * Grade a model's live residual spread against its reference SD.
 *
 * UNKNOWN — never OK — whenever the comparison cannot be made: no reference
 * SD (a run that recorded no usable metric), no joined pairs, too few pairs,
 * or a degenerate live SD. "We cannot tell" and "it is fine" are different
 * answers, and collapsing them is how a monitoring axis goes quietly green
 * on a model nobody is actually watching.
 */
export function classifyResidualSd(input: {
  /** `InferenceWindowTruth` rows for the range being judged. */
  windows: readonly TruthStats[];
  /** From `baselineResidualSd` — null when the version has none. */
  baselineSd: number | null;
  thresholds: ResidualSdThresholds;
}): ResidualSdVerdict {
  const { baselineSd, thresholds } = input;
  const pooled = poolTruthStats(input.windows);
  const live = computeLiveError(pooled);

  const unknown: ResidualSdVerdict = {
    status: 'UNKNOWN',
    liveSd: live?.sd ?? null,
    ratio: null,
    baselineSd,
    n: pooled.n,
  };

  if (baselineSd === null || !(baselineSd > 0)) return unknown;
  if (!live) return unknown;
  if (live.n < MIN_RESIDUAL_SD_PAIRS) return unknown;
  if (!Number.isFinite(live.sd)) return unknown;

  const ratio = live.sd / baselineSd;

  // A spread SMALLER than the reference is a better model than the one that
  // was accepted, not a fault — the test is one-sided on purpose.
  const status: ResidualSdStatus =
    ratio >= thresholds.criticalSd
      ? 'ALERT'
      : ratio >= thresholds.warnSd
        ? 'WARN'
        : 'OK';

  return { status, liveSd: live.sd, ratio, baselineSd, n: live.n };
}
