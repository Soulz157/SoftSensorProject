import type {
  ColumnBaselineMap,
  FeatureStatsMap,
} from '@/lib/prediction-drift';

/**
 * MODEL-SERVE-001-T29. SENSOR FROZEN — a tag whose value has not moved across
 * the last N windows, which is a DATA fault (the monitoring axis), never a
 * deploy one: the scheduler is dispatching perfectly, the sensor is stuck.
 *
 * WHY THIS IS NOT `poolFeatureStats`, THOUGH THE SHAPES MATCH. That helper
 * (lib/prediction-drift.ts) takes GLOBAL extremes across every window handed
 * to it, and its caller pools the standard `take: 24`. Pooling 24 windows
 * destroys the very signal this function needs — a tag that sat still for the
 * last three hours is invisible inside a day's worth of movement — and it
 * also discards each window's own `n`, which guard (4) below depends on. So
 * this module pools its OWN small slice and keeps per-window identity.
 *
 * UNITS. `featureStats` are in MODEL-READY (scaled) units, produced by
 * `_scaled_feature_stats` against the FROZEN `scalingParams`, and
 * `column_stats.json` (the baseline) is built over the same scaled GOLD
 * frame. Both sides of every comparison here are therefore in one unit
 * system. Do NOT assume that system is `[0, 1]`: T17 measured a real scaled
 * value of -1.17 on a window whose values fell outside the trained range.
 */

export interface FrozenInput {
  /** Newest first, already limited to the `frozenWindows` most recent
   *  windows that carry stats. A window with no stats is not a window with
   *  flat stats — the caller drops those before this sees them. */
  windows: FeatureStatsMap[];
  /** `resolveColumnBaseline`'s output. EMPTY IS NOT "no tag is flat": an
   *  empty baseline means the column_stats read failed or the artifact has
   *  none, in which case guard (1) cannot be applied and this returns no
   *  columns at all rather than badging every one of them. */
  baseline: ColumnBaselineMap;
  frozenWindows: number;
  /** A FRACTION OF THE TRAINING RANGE, not an absolute value. 0 means exact
   *  flatness, which is the only threshold that is meaningful without
   *  reference to a column's own spread. */
  frozenTolerancePct: number;
}

/**
 * Guard (4)'s floor, and DELIBERATELY NOT the schedule's `minRows`.
 *
 * Two points is the minimum that can have a range at all, which is the whole
 * of guard (4)'s stated concern ("a one-row window reads flat by
 * construction"). `minRows` is a much larger number and IS the SKIPPED
 * threshold — a window below it is SKIPPED by definition — so using it here
 * would discard every SKIPPED window and destroy T29's own stated side
 * effect: "a SKIPPED window carries featureStats too (put_frame runs before
 * the minRows check, confirmed live in T17), so a thin-but-stuck plant is
 * still caught". A quiet plant going stuck is exactly the case worth
 * catching. Do not "tidy" this into `minRows`.
 */
const MIN_ROWS_PER_WINDOW = 2;

/** `std` at or below this reads as "flat in training" for guard (1). Not
 *  zero-exact: a column_stats std is a float over GOOD cells and a
 *  genuinely-constant column can land a hair off zero. */
const TRAINING_FLAT_STD = 1e-9;

/**
 * Returns the columns that are frozen, sorted, or `[]`.
 *
 * FIVE GUARDS, NONE OPTIONAL — each one is a case in V21, and each exists
 * because without it this function reports a fault that is not there:
 *
 * (1) A TAG ALREADY FLAT IN TRAINING IS SKIPPED. A setpoint, or a valve held
 *     closed, has a zero-range live window because it has ALWAYS had one.
 *     Badging it says a sensor died when nothing changed at all, and it would
 *     say so forever. This is V21's "more important half".
 * (2) WINDOWS, NOT ROWS. Require `frozenWindows` windows carrying stats. T14
 *     proved a row count is the wrong axis: each schedule has its own
 *     `fetchConfig.intervalTime`, so three hours is 36 rows at a 5-minute
 *     interval and 180 at a 1-minute one.
 * (3) eps IS A FRACTION OF THE TRAINING RANGE. `frozenTolerancePct * (p99 -
 *     p1)`, so the same setting means the same thing on a tag spanning 0.01
 *     and one spanning 400. p1/p99 rather than min/max because the baseline
 *     deliberately carries only those (and they are robust to the single
 *     outlier that would otherwise inflate the range).
 * (4) A MINIMUM `n` PER WINDOW — see MIN_ROWS_PER_WINDOW.
 * (5) AN ABSENT COLUMN IS SKIPPED, NEVER FLAT. A tag whose scaler is not
 *     "none" and which has no `scalingParams` entry is excluded from
 *     `featureStats` entirely (inference_window_service.py's `covered`
 *     partition). Absence means "not measured here", not "not moving".
 */
export function detectFrozenColumns(input: FrozenInput): string[] {
  const { windows, baseline, frozenWindows, frozenTolerancePct } = input;

  // Guard (2). Fewer windows than asked for is not evidence of stillness —
  // it is not enough evidence to say anything.
  if (frozenWindows <= 0 || windows.length < frozenWindows) return [];

  const sample = windows.slice(0, frozenWindows);
  const frozen: string[] = [];

  for (const [column, base] of Object.entries(baseline)) {
    // Guard (1).
    if (base.std === null || Math.abs(base.std) <= TRAINING_FLAT_STD) continue;

    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;
    let covered = true;

    for (const window of sample) {
      const agg = window[column];
      // Guards (5) and (4). One uncovered window disqualifies the whole
      // verdict rather than being skipped over: "flat across three windows"
      // has to mean three windows.
      if (!agg || agg.n < MIN_ROWS_PER_WINDOW) {
        covered = false;
        break;
      }
      if (!Number.isFinite(agg.min) || !Number.isFinite(agg.max)) {
        covered = false;
        break;
      }
      min = Math.min(min, agg.min);
      max = Math.max(max, agg.max);
    }
    if (!covered) continue;

    // Guard (3).
    const eps = epsFor(base, frozenTolerancePct);
    if (eps === null) continue;
    if (max - min <= eps) frozen.push(column);
  }

  return frozen.sort();
}

/**
 * `null` when no honest eps exists — a non-zero tolerance was asked for but
 * the baseline carries no percentile range to express it against. Returning
 * 0 there would silently apply a DIFFERENT (stricter) rule than the operator
 * configured, which is the "guess wearing a formula" this ledger keeps
 * refusing; returning null skips the column instead.
 */
function epsFor(
  base: { percentiles: { p1?: number; p99?: number } | null },
  frozenTolerancePct: number,
): number | null {
  if (frozenTolerancePct <= 0) return 0;

  const p1 = base.percentiles?.p1;
  const p99 = base.percentiles?.p99;
  if (typeof p1 !== 'number' || typeof p99 !== 'number') return null;
  if (!Number.isFinite(p1) || !Number.isFinite(p99)) return null;

  const trainingRange = Math.abs(p99 - p1);
  if (trainingRange === 0) return null;

  return frozenTolerancePct * trainingRange;
}
