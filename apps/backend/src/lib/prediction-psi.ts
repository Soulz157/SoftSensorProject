/**
 * MODEL-SERVE-001-T13. PSI (Population Stability Index) — the ONLY input
 * drift metric since MODEL-SERVE-028 (2026-10-04), which removed the z-score
 * mean-shift signal (`prediction-drift.ts`) this was first published beside,
 * at the user's request: one drift signal for a Data Scientist to read.
 * Pure functions, no I/O.
 *
 * The caller resolves both inputs: `poolHistograms` combines the
 * `PredictionLog.featureHistograms` / `InferenceWindow.featureHistograms`
 * Json blobs a time-range query returns; `computePsi` compares the pooled
 * result against `feature_spec.json`'s `psiRefEdges`/`psiBinCount`/
 * `psiBinMode`/`psiRefCounts` (read via `resolvePsiReference`, the same
 * sidecar the serving descriptor already reads — see
 * `model-serving.authorized.service.ts`).
 *
 * PSI needs `binCount * PSI_MIN_SAMPLES_PER_BIN` live samples before a
 * figure is even computed, which a single inference window's traffic will
 * often not clear. The caller is expected to pool over a LONG time range
 * (rolling 24 windows) — this module does not enforce or assume any
 * particular range, only the sample floor itself.
 */

/** One request's raw-value histogram for one column — the shape
 *  `PredictionLog.featureHistograms` stores per tag, bucketed at WRITE
 *  time in `apps/serving` against that tag's frozen `psiRefEdges`. `below`/
 *  `above` are live mass OUTSIDE the trained edge range, kept separate
 *  from `counts` rather than folded into an end bin. */
export interface FeatureHistogram {
  counts: number[];
  below: number;
  above: number;
}

export type FeatureHistogramMap = Record<string, FeatureHistogram | null>;

/** One tag's frozen PSI reference — `feature_spec.json`'s own
 *  `psiRefEdges`/`psiBinCount`/`psiBinMode`/`psiRefCounts`, unpacked back
 *  into one object per tag for this module's own convenience. `refCounts`
 *  is the REAL measured training-split population per bin — see
 *  `softsensor_scaling.psi`'s own module docstring for why this is never
 *  assumed uniform (a categorical split is not equal-frequency the way a
 *  quantile split is). `refCounts` is guaranteed non-zero for every entry
 *  by construction on the Python side (`quantile_edges`'s own
 *  zero-reference-count disqualifier) — `computePsi` does not re-verify
 *  this — the Python side's construction is trusted. */
export interface PsiReference {
  binMode: 'continuous' | 'categorical';
  binCount: number;
  edges: number[];
  refCounts: number[];
}

export type PsiReferenceMap = Record<string, PsiReference | undefined>;

export interface PsiThresholds {
  warn: number;
  critical: number;
  minSamplesPerBin: number;
  /** MODEL-SERVE-029. `outOfRangePct` cutoffs (percent of `liveTotal`). */
  outOfRangeWarnPct: number;
  outOfRangeCriticalPct: number;
}

export type PsiStatus =
  | 'OK'
  | 'WARN'
  | 'CRITICAL'
  | 'UNKNOWN'
  | 'INSUFFICIENT_DATA';

/**
 * Per-column raw bin data — MODEL-SERVE-001-T16 (the display spec T13
 * itself chose but did not wire to the API: a summary card, a per-tag
 * reference-vs-current bar chart, and an engineering-unit bin-edge table,
 * none of which are buildable from a bare `psi` number).
 *
 * `null` exactly when `status` is `UNKNOWN` — no training reference exists
 * for this column, so there is nothing to show bins FOR. Present on every
 * OTHER status, INCLUDING `INSUFFICIENT_DATA`: a below-floor tag still has
 * a real reference and a real (if too-small) live pool, and a reader needs
 * `liveInRangeTotal`/`below`/`above` and `minSamples` to print "412 of 600
 * rows" rather than a bare "insufficient data" with no shape to it.
 *
 * NEVER a license to draw a chart below the sample floor — a histogram at
 * 2 samples per bin looks exactly like a real signal and is not one (T13's
 * own words). The `INSUFFICIENT_DATA` row's `bins` exists for the
 * rows-vs-floor readout only; the caller must not open a drill-down there.
 */
export interface ColumnBins {
  binMode: 'continuous' | 'categorical';
  /** RESOLVED count, never a default a reader might assume — a degenerate
   *  tag's reduced bin count must be visible, never presumed to be 10. */
  binCount: number;
  /** Frozen at training time, RAW engineering units — the SAME array
   *  reference as `PsiReference.edges` (`prediction-psi.spec.ts` asserts
   *  this identity). Echoed, never re-derived or copied. */
  edges: number[];
  /** MEASURED reference population per bin, same array reference as
   *  `PsiReference.refCounts` — see `psi.py`'s own module docstring for why
   *  this is never assumed uniform (a categorical split is not
   *  equal-frequency the way a quantile split is). */
  refCounts: number[];
  liveCounts: number[];
  below: number;
  above: number;
  /** PSI's OWN denominator — `sum(liveCounts)`, EXCLUDING below/above.
   *  Sent explicitly so a drill-down's percentages reconcile with `psi`
   *  instead of the caller guessing between this and `liveTotal`. */
  liveInRangeTotal: number;
  /** `binCount * minSamplesPerBin` — the floor `liveTotal` is tested
   *  against below. */
  minSamples: number;
}

export interface ColumnPsi {
  column: string;
  /** Live samples pooled for this column, INCLUDING below/above overflow —
   *  what `minSamplesPerBin * binCount` is compared against. */
  liveTotal: number;
  /** Null exactly when `status` is `UNKNOWN` or `INSUFFICIENT_DATA`, or
   *  when EVERY live sample fell outside the trained edges (CRITICAL with
   *  a `reason` — no in-range sample leaves PSI's live% term undefined,
   *  MODEL-SERVE-029). A number here always means a real, computed PSI,
   *  never a placeholder (T13's own instruction: "publish 'insufficient
   *  data', never a numeric PSI"). */
  psi: number | null;
  /** Live mass that fell OUTSIDE the trained edge range, as a percentage
   *  of `liveTotal` — a REAL measured count, straight from the live
   *  histogram's below/above bins. (MODEL-SERVE-001-T31: the since-removed `prediction-drift`
   *  once published a rival PARAMETRIC estimate of this same quantity, and
   *  even let it raise a z-score WARN; it was deleted, and this is now the
   *  only out-of-range figure in the app.) Never folded into `psi`
   *  itself: the reference has no below/above mass to compare against
   *  (every training value lies within its own derived edges — guaranteed
   *  for models fitted after MODEL-SERVE-029, whose outer edges cover the
   *  train min/max). GRADED by its own thresholds instead
   *  (`PsiThresholds.outOfRange*Pct`, MODEL-SERVE-029): `status` is the
   *  worse of the PSI verdict and this one. This stays the one RENDERED
   *  overflow figure — `bins.below`/`bins.above` below are for a
   *  drill-down's own display, derived from the SAME counts, never a
   *  second independently-computed percentage. */
  outOfRangePct: number | null;
  status: PsiStatus;
  reason?: string;
  /** See `ColumnBins`'s own doc comment for exactly when this is null. */
  bins: ColumnBins | null;
}

export interface PsiReport {
  status: PsiStatus;
  columns: ColumnPsi[];
}

/**
 * Combine N requests' worth of per-column histograms into one, by simple
 * elementwise addition of `counts`/`below`/`above` — this is what makes
 * binning at WRITE time (never at read time) pay off: pooling never
 * re-opens a raw-row Parquet object.
 *
 * A column whose `counts.length` disagrees between inputs (a live window
 * spanning a promote to a version with different frozen edges) is
 * DROPPED from the LATER input for that column, not summed mismatched —
 * summing bins from two different edge sets would silently corrupt the
 * histogram, the same contamination the shared-bucket-basis rule exists to
 * prevent. In steady operation within one PRODUCTION version's lifetime
 * this never fires (edges are frozen for the version's whole life); it
 * only guards the boundary case.
 */
export function poolHistograms(
  inputs: FeatureHistogramMap[],
): FeatureHistogramMap {
  const pooled: FeatureHistogramMap = {};
  for (const input of inputs) {
    for (const [column, hist] of Object.entries(input)) {
      if (!hist) continue;
      const existing = pooled[column];
      if (!existing) {
        pooled[column] = {
          counts: [...hist.counts],
          below: hist.below,
          above: hist.above,
        };
        continue;
      }
      if (existing.counts.length !== hist.counts.length) continue;
      pooled[column] = {
        counts: existing.counts.map((c, i) => c + hist.counts[i]),
        below: existing.below + hist.below,
        above: existing.above + hist.above,
      };
    }
  }
  return pooled;
}

/** Floor applied to both sides of the PSI ratio before `ln` — the ONLY
 *  place this module ever substitutes a computed zero. Named and commented
 *  per T13's own instruction ("the usual fix... must be stated rather than
 *  hidden in a constant"), not folded into a bare literal at the call site.
 *  Only ever needed on the ACTUAL (live) side in practice — the reference
 *  side is proven non-zero by `quantile_edges`'s own construction — but
 *  applied symmetrically anyway, which is the standard, safer form of the
 *  formula and costs nothing when the reference side never needs it.
 *
 *  EXPORTED (T16) so the screen can state it next to the 0.1/0.25
 *  thresholds — T13's cost (b): a value that depends on a constant must
 *  say so, never hide it. */
export const PSI_EPSILON = 1e-4;

function psiForColumn(live: FeatureHistogram, ref: PsiReference): number {
  const liveInRangeTotal = live.counts.reduce((a, b) => a + b, 0);
  const refTotal = ref.refCounts.reduce((a, b) => a + b, 0);

  let psi = 0;
  for (let i = 0; i < ref.refCounts.length; i++) {
    const actual = Math.max(live.counts[i] / liveInRangeTotal, PSI_EPSILON);
    const expected = Math.max(ref.refCounts[i] / refTotal, PSI_EPSILON);
    psi += (actual - expected) * Math.log(actual / expected);
  }
  return psi;
}

/**
 * MODEL-SERVE-001-T32. NO HYSTERESIS HERE, AND THAT IS A DECISION.
 *
 * PSI is computed over a rolling-24 window of pooled histograms, so the
 * smoothing a consecutive-breach rule would add is already inside the
 * measurement. A rule on top would delay a real population shift by hours
 * to suppress noise the pooling has already removed. (The removed z-score
 * signal had one — `applyConsecutiveBreachRule`, MODEL-SERVE-008-T03 —
 * because it was graded per dense bucket.)
 *
 * If that rolling window ever narrows, revisit this comment first.
 */
function statusFor(psi: number, thresholds: PsiThresholds): PsiStatus {
  if (psi >= thresholds.critical) return 'CRITICAL';
  if (psi >= thresholds.warn) return 'WARN';
  return 'OK';
}

/** MODEL-SERVE-029. The out-of-range share graded on its own — PSI cannot
 *  see below/above mass, so without this a tag drifting PAST its trained
 *  range reads only as well as whatever is left inside it. */
function outOfRangeStatusFor(
  outOfRangePct: number,
  thresholds: PsiThresholds,
): PsiStatus {
  if (outOfRangePct >= thresholds.outOfRangeCriticalPct) return 'CRITICAL';
  if (outOfRangePct >= thresholds.outOfRangeWarnPct) return 'WARN';
  return 'OK';
}

/** Severity order for rolling per-column statuses into one report status.
 *  UNKNOWN (no reference at all) never masks a worse KNOWN status, and
 *  INSUFFICIENT_DATA (a real reference, just not enough live volume yet)
 *  sits above UNKNOWN for the same reason — it is more information, not
 *  less — but still never masks a real OK/WARN/CRITICAL verdict on another
 *  column. */
const SEVERITY: Record<PsiStatus, number> = {
  UNKNOWN: 0,
  INSUFFICIENT_DATA: 1,
  OK: 2,
  WARN: 3,
  CRITICAL: 4,
};

/**
 * The comparison. Iterates `live`'s OWN columns, never the reference's —
 * a reference tag with no live
 * counterpart is simply not compared, neither UNKNOWN nor a gap).
 */
export function computePsi(
  live: FeatureHistogramMap,
  reference: PsiReferenceMap,
  thresholds: PsiThresholds,
): PsiReport {
  const columns: ColumnPsi[] = [];

  for (const [column, hist] of Object.entries(live)) {
    if (!hist) continue;
    const liveTotal =
      hist.counts.reduce((a, b) => a + b, 0) + hist.below + hist.above;

    const ref = reference[column];
    if (!ref) {
      columns.push({
        column,
        liveTotal,
        psi: null,
        outOfRangePct: null,
        status: 'UNKNOWN',
        reason: 'no training reference for this column',
        bins: null,
      });
      continue;
    }

    if (hist.counts.length !== ref.refCounts.length) {
      columns.push({
        column,
        liveTotal,
        psi: null,
        outOfRangePct: null,
        status: 'UNKNOWN',
        reason:
          'histogram bin count does not match the reference — likely a ' +
          'promote across two versions with different frozen edges',
        bins: null,
      });
      continue;
    }

    const minSamples = ref.binCount * thresholds.minSamplesPerBin;
    const outOfRangePct =
      liveTotal > 0 ? ((hist.below + hist.above) / liveTotal) * 100 : null;
    // T16: bins populated from here on — a real reference and a
    // bin-count-compatible live histogram both exist, whether or not the
    // sample floor below is cleared.
    const liveInRangeTotal = hist.counts.reduce((a, b) => a + b, 0);
    const bins: ColumnBins = {
      binMode: ref.binMode,
      binCount: ref.binCount,
      edges: ref.edges,
      refCounts: ref.refCounts,
      liveCounts: hist.counts,
      below: hist.below,
      above: hist.above,
      liveInRangeTotal,
      minSamples,
    };

    if (liveTotal < minSamples) {
      columns.push({
        column,
        liveTotal,
        psi: null,
        outOfRangePct,
        status: 'INSUFFICIENT_DATA',
        reason: `${liveTotal} live sample(s), below ${minSamples} (binCount ${ref.binCount} x PSI_MIN_SAMPLES_PER_BIN)`,
        bins,
      });
      continue;
    }

    // MODEL-SERVE-029. Every live sample outside the trained edges is the
    // WORST drift there is, not an absence of it: PSI's live% term has no
    // denominator (0/0 = NaN, and `statusFor(NaN)` used to read OK).
    if (liveInRangeTotal === 0) {
      columns.push({
        column,
        liveTotal,
        psi: null,
        outOfRangePct,
        status: 'CRITICAL',
        reason: `all ${liveTotal} live sample(s) fell outside the trained range`,
        bins,
      });
      continue;
    }

    const psi = psiForColumn(hist, ref);
    // Defensive: a non-finite PSI (a reference with zero total count, which
    // `quantile_edges` never writes) must never be graded — NaN compares
    // false against every threshold and would read OK.
    if (!Number.isFinite(psi)) {
      columns.push({
        column,
        liveTotal,
        psi: null,
        outOfRangePct,
        status: 'UNKNOWN',
        reason: 'PSI is not computable against this reference',
        bins,
      });
      continue;
    }

    const psiStatus = statusFor(psi, thresholds);
    const rangeStatus = outOfRangeStatusFor(outOfRangePct ?? 0, thresholds);
    const rangeIsWorse = SEVERITY[rangeStatus] > SEVERITY[psiStatus];
    columns.push({
      column,
      liveTotal,
      psi,
      outOfRangePct,
      status: rangeIsWorse ? rangeStatus : psiStatus,
      ...(rangeIsWorse && {
        reason: `${(outOfRangePct ?? 0).toFixed(1)}% of live samples outside the trained range`,
      }),
      bins,
    });
  }

  const overall = columns.reduce<PsiStatus>(
    (worst, c) => (SEVERITY[c.status] > SEVERITY[worst] ? c.status : worst),
    'UNKNOWN',
  );

  return { status: overall, columns };
}
