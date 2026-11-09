import { env } from '@/config/env.config';

/**
 * MODEL-SERVE-036. Input drift by TRAINING RANGE — replaces PSI (user
 * decision 2026-10-19, reversing MODEL-SERVE-028).
 *
 * A live value below the training min or above the training max is drift.
 * A column is graded by the share of its live values outside that range:
 * WARN at `outOfRangeWarnPct`, CRITICAL at `outOfRangeCriticalPct`
 * (env, conventional starting points, not measured on any plant).
 *
 * THE TRAINING RANGE is a tag's frozen reference edges in
 * `feature_spec.json` (`psiRefEdges` — a storage key kept for every existing
 * spec): `edges[0]` and `edges.at(-1)`, widened to the true train min/max by
 * MODEL-SERVE-029. Below/above are counted by the shared
 * `softsensor_scaling.bucket_value` primitive on the Python side (window
 * histograms, serving histograms and the input-series read alike), so a
 * categorical tag's half-gap tolerance applies everywhere the same way.
 *
 * The in-range bin counts are still carried (`bins`) for the Deep Detail
 * distribution chart; they grade nothing.
 */

export interface FeatureHistogram {
  counts: number[];
  below: number;
  above: number;
}

export type FeatureHistogramMap = Record<string, FeatureHistogram | null>;

/** A tag's frozen training reference from `feature_spec.json`. */
export interface DriftReference {
  binMode: 'continuous' | 'categorical';
  binCount: number;
  /** RAW engineering units. Continuous: `binCount + 1` boundaries;
   *  categorical: the trained values themselves. */
  edges: number[];
  refCounts: number[];
}

export type DriftReferenceMap = Record<string, DriftReference | undefined>;

export interface DriftThresholds {
  outOfRangeWarnPct: number;
  outOfRangeCriticalPct: number;
  /** Fewer live values than this and a column is not graded. */
  minSamples: number;
}

/**
 * `UNKNOWN`: no training range recorded (no verdict at all).
 * `INSUFFICIENT_DATA`: a range exists, too few live values to grade.
 */
export type DriftStatus =
  | 'OK'
  | 'WARN'
  | 'CRITICAL'
  | 'UNKNOWN'
  | 'INSUFFICIENT_DATA';

/** Live vs training distribution, for display only. */
export interface ColumnBins {
  binMode: 'continuous' | 'categorical';
  binCount: number;
  edges: number[];
  refCounts: number[];
  liveCounts: number[];
  below: number;
  above: number;
  /** `sum(liveCounts)`, excluding below/above. */
  liveInRangeTotal: number;
  /** The grading floor (`thresholds.minSamples`). */
  minSamples: number;
}

export interface ColumnRangeDrift {
  column: string;
  liveTotal: number;
  below: number;
  above: number;
  /** Null without a training range or without a live value. */
  outOfRangePct: number | null;
  trainMin: number | null;
  trainMax: number | null;
  binMode: 'continuous' | 'categorical' | null;
  status: DriftStatus;
  reason?: string;
  bins: ColumnBins | null;
}

export interface RangeDriftReport {
  status: DriftStatus;
  columns: ColumnRangeDrift[];
}

/** The env-configured thresholds every grading path uses. */
export function driftThresholds(): DriftThresholds {
  return {
    outOfRangeWarnPct: env.INPUT_DRIFT_OUT_OF_RANGE_WARN_PCT,
    outOfRangeCriticalPct: env.INPUT_DRIFT_OUT_OF_RANGE_CRITICAL_PCT,
    minSamples: env.INPUT_DRIFT_MIN_SAMPLES,
  };
}

/**
 * Element-wise sum per column. A histogram whose bin count differs from the
 * first one seen for its column is DROPPED (a promote across versions with
 * different frozen edges) rather than misaligned.
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

export function outOfRangeStatusFor(
  outOfRangePct: number,
  thresholds: DriftThresholds,
): DriftStatus {
  if (outOfRangePct >= thresholds.outOfRangeCriticalPct) return 'CRITICAL';
  if (outOfRangePct >= thresholds.outOfRangeWarnPct) return 'WARN';
  return 'OK';
}

/** The training range: the reference's outer edges. */
export function trainRangeOf(ref: DriftReference): {
  trainMin: number | null;
  trainMax: number | null;
} {
  if (ref.edges.length === 0) return { trainMin: null, trainMax: null };
  return { trainMin: ref.edges[0], trainMax: ref.edges[ref.edges.length - 1] };
}

const SEVERITY: Record<DriftStatus, number> = {
  UNKNOWN: 0,
  INSUFFICIENT_DATA: 1,
  OK: 2,
  WARN: 3,
  CRITICAL: 4,
};

export function worstStatus(statuses: DriftStatus[]): DriftStatus {
  return statuses.reduce<DriftStatus>(
    (worst, s) => (SEVERITY[s] > SEVERITY[worst] ? s : worst),
    'UNKNOWN',
  );
}

/** Grade one column from its pooled live histogram. */
export function gradeColumn(
  column: string,
  hist: FeatureHistogram,
  ref: DriftReference | undefined,
  thresholds: DriftThresholds,
): ColumnRangeDrift {
  const liveInRangeTotal = hist.counts.reduce((a, b) => a + b, 0);
  const liveTotal = liveInRangeTotal + hist.below + hist.above;

  if (!ref) {
    return {
      column,
      liveTotal,
      below: 0,
      above: 0,
      outOfRangePct: null,
      trainMin: null,
      trainMax: null,
      binMode: null,
      status: 'UNKNOWN',
      reason: 'no training range recorded — retrain to enable',
      bins: null,
    };
  }

  const { trainMin, trainMax } = trainRangeOf(ref);
  const base = {
    column,
    liveTotal,
    below: hist.below,
    above: hist.above,
    trainMin,
    trainMax,
    binMode: ref.binMode,
  };

  if (hist.counts.length !== ref.refCounts.length) {
    return {
      ...base,
      below: 0,
      above: 0,
      outOfRangePct: null,
      status: 'UNKNOWN',
      reason:
        'live values were counted against a different training range — ' +
        'likely a promote across two versions',
      bins: null,
    };
  }

  const outOfRangePct =
    liveTotal > 0 ? ((hist.below + hist.above) / liveTotal) * 100 : null;
  const bins: ColumnBins = {
    binMode: ref.binMode,
    binCount: ref.binCount,
    edges: ref.edges,
    refCounts: ref.refCounts,
    liveCounts: hist.counts,
    below: hist.below,
    above: hist.above,
    liveInRangeTotal,
    minSamples: thresholds.minSamples,
  };

  if (liveTotal < thresholds.minSamples || outOfRangePct === null) {
    return {
      ...base,
      outOfRangePct,
      status: 'INSUFFICIENT_DATA',
      reason: `${liveTotal} live value(s), below ${thresholds.minSamples} (INPUT_DRIFT_MIN_SAMPLES)`,
      bins,
    };
  }

  const status = outOfRangeStatusFor(outOfRangePct, thresholds);
  return {
    ...base,
    outOfRangePct,
    status,
    ...(status !== 'OK' && {
      reason: `${outOfRangePct.toFixed(1)}% of live values outside the training range`,
    }),
    bins,
  };
}

/** Grade every column of a pooled live histogram map. */
export function computeRangeDrift(
  live: FeatureHistogramMap,
  reference: DriftReferenceMap,
  thresholds: DriftThresholds,
): RangeDriftReport {
  const columns: ColumnRangeDrift[] = [];
  for (const [column, hist] of Object.entries(live)) {
    if (!hist) continue;
    columns.push(gradeColumn(column, hist, reference[column], thresholds));
  }
  return { status: worstStatus(columns.map((c) => c.status)), columns };
}

/** One column as the Python input-series read returns it. */
export interface SeriesColumnInput {
  resolution: 'raw' | 'bucketed';
  bucket_minutes: number | null;
  points: Array<{
    t: string;
    value: number;
    min: number;
    max: number;
    out_of_range: number;
  }>;
  windows: Array<{
    window_start: string;
    window_end: string;
    n: number;
    min: number | null;
    max: number | null;
    mean: number | null;
    below: number;
    above: number;
  }>;
  total: number;
  below: number;
  above: number;
  counts: number[] | null;
  live_min: number | null;
  live_max: number | null;
  live_mean: number | null;
  last_out_of_range_at: string | null;
}

/** The trend a client draws for one column (camelCase wire shape). */
export interface InputTrendSeries {
  resolution: 'raw' | 'bucketed';
  bucketMinutes: number | null;
  points: Array<{
    t: string;
    value: number;
    min: number;
    max: number;
    outOfRange: number;
  }>;
  windows: Array<{
    windowStart: string;
    windowEnd: string;
    n: number;
    min: number | null;
    max: number | null;
    mean: number | null;
    below: number;
    above: number;
  }>;
  liveMin: number | null;
  liveMax: number | null;
  liveMean: number | null;
  lastOutOfRangeAt: string | null;
}

/**
 * Grade every column from the rows the trend was drawn from, so the badge,
 * chart, stats and per-window table describe one population. A column the
 * reference does not cover is UNKNOWN but keeps its live count and trend.
 */
export function gradeSeries(
  columns: Record<string, SeriesColumnInput>,
  reference: DriftReferenceMap,
  thresholds: DriftThresholds,
): {
  report: RangeDriftReport;
  series: Record<string, InputTrendSeries>;
} {
  const graded: ColumnRangeDrift[] = [];
  const series: Record<string, InputTrendSeries> = {};
  for (const [column, s] of Object.entries(columns)) {
    const ref = reference[column];
    // Python counts against the edges this service sent, so `counts` always
    // has the reference's length; a mismatch grades UNKNOWN in gradeColumn.
    const hist: FeatureHistogram = ref
      ? { counts: s.counts ?? [], below: s.below, above: s.above }
      : { counts: [], below: 0, above: 0 };
    const col = gradeColumn(column, hist, ref, thresholds);
    graded.push({ ...col, liveTotal: s.total });
    series[column] = {
      resolution: s.resolution,
      bucketMinutes: s.bucket_minutes,
      points: s.points.map((p) => ({
        t: p.t,
        value: p.value,
        min: p.min,
        max: p.max,
        outOfRange: p.out_of_range,
      })),
      windows: s.windows.map((w) => ({
        windowStart: w.window_start,
        windowEnd: w.window_end,
        n: w.n,
        min: w.min,
        max: w.max,
        mean: w.mean,
        below: w.below,
        above: w.above,
      })),
      liveMin: s.live_min,
      liveMax: s.live_max,
      liveMean: s.live_mean,
      lastOutOfRangeAt: s.last_out_of_range_at,
    };
  }
  return {
    report: {
      status: worstStatus(graded.map((c) => c.status)),
      columns: graded,
    },
    series,
  };
}

/**
 * `softsensor_scaling.bucket_value`, mirrored for the /predict plane, whose
 * raw rows arrive here rather than in Python. Continuous: `[edges[i],
 * edges[i+1])`, last bin closed on the right, outside `[edges[0],
 * edges.at(-1)]` is overflow. Categorical: nearest trained value, overflow
 * only past either end by more than half the smallest gap.
 */
export function bucketValue(
  value: number,
  ref: Pick<DriftReference, 'edges' | 'binMode'>,
): { index: number | null; overflow: 'below' | 'above' | null } {
  const { edges } = ref;
  if (ref.binMode === 'categorical') {
    let tolerance = 0;
    if (edges.length >= 2) {
      tolerance = Infinity;
      for (let i = 1; i < edges.length; i++) {
        tolerance = Math.min(tolerance, edges[i] - edges[i - 1]);
      }
      tolerance /= 2;
    }
    if (value < edges[0] - tolerance) return { index: null, overflow: 'below' };
    if (value > edges[edges.length - 1] + tolerance) {
      return { index: null, overflow: 'above' };
    }
    let nearest = 0;
    for (let i = 1; i < edges.length; i++) {
      if (Math.abs(edges[i] - value) < Math.abs(edges[nearest] - value)) {
        nearest = i;
      }
    }
    return { index: nearest, overflow: null };
  }
  if (value < edges[0]) return { index: null, overflow: 'below' };
  if (value > edges[edges.length - 1])
    return { index: null, overflow: 'above' };
  let idx = 0;
  while (idx + 1 < edges.length && edges[idx + 1] <= value) idx++;
  return {
    index: Math.max(0, Math.min(idx, edges.length - 2)),
    overflow: null,
  };
}

const BUCKET_MINUTES = [1, 2, 5, 10, 15, 30, 60, 120, 240, 360, 720, 1440];
const HOUR_MS = 3_600_000;

function bucketMinutesFor(spanMinutes: number, maxPoints: number): number {
  const need = spanMinutes / maxPoints;
  return BUCKET_MINUTES.find((w) => w >= need) ?? Math.ceil(need / 1440) * 1440;
}

/**
 * MODEL-SERVE-036, /predict plane. The same per-column shape the Python
 * input-series read returns, built from logged rows: hourly "windows",
 * the trend (raw or bucketed, min/max kept), and below/above + in-range
 * counts by `bucketValue`.
 */
export function buildRowSeries(
  rows: Array<{ timestamp: string; features: Record<string, number> }>,
  reference: DriftReferenceMap,
  maxPoints: number,
): Record<string, SeriesColumnInput> {
  const byColumn = new Map<string, Array<{ t: number; v: number }>>();
  for (const row of rows) {
    const t = Date.parse(row.timestamp);
    if (Number.isNaN(t)) continue;
    for (const [column, v] of Object.entries(row.features)) {
      if (typeof v !== 'number' || !Number.isFinite(v)) continue;
      const list = byColumn.get(column) ?? [];
      list.push({ t, v });
      byColumn.set(column, list);
    }
  }

  const out: Record<string, SeriesColumnInput> = {};
  for (const [column, list] of byColumn) {
    list.sort((a, b) => a.t - b.t);
    const ref = reference[column];
    const counts = ref ? new Array<number>(ref.refCounts.length).fill(0) : null;
    const flagged = list.map(({ t, v }) => {
      if (!ref) return { t, v, out: 0, side: null as 'below' | 'above' | null };
      const { index, overflow } = bucketValue(v, ref);
      if (index !== null && counts && index < counts.length) counts[index]++;
      return { t, v, out: overflow ? 1 : 0, side: overflow };
    });

    const hours = new Map<number, typeof flagged>();
    for (const f of flagged) {
      const h = Math.floor(f.t / HOUR_MS) * HOUR_MS;
      const bucket = hours.get(h) ?? [];
      bucket.push(f);
      hours.set(h, bucket);
    }
    const windows = [...hours.entries()]
      .sort((a, b) => b[0] - a[0])
      .map(([h, fs]) => {
        const vs = fs.map((f) => f.v);
        return {
          window_start: new Date(h).toISOString(),
          window_end: new Date(h + HOUR_MS).toISOString(),
          n: vs.length,
          min: Math.min(...vs),
          max: Math.max(...vs),
          mean: vs.reduce((a, b) => a + b, 0) / vs.length,
          below: fs.filter((f) => f.side === 'below').length,
          above: fs.filter((f) => f.side === 'above').length,
        };
      });

    let resolution: 'raw' | 'bucketed' = 'raw';
    let bucketMinutes: number | null = null;
    let points: SeriesColumnInput['points'];
    if (flagged.length <= maxPoints) {
      points = flagged.map((f) => ({
        t: new Date(f.t).toISOString(),
        value: f.v,
        min: f.v,
        max: f.v,
        out_of_range: f.out,
      }));
    } else {
      resolution = 'bucketed';
      const span = Math.max(
        (flagged[flagged.length - 1].t - flagged[0].t) / 60_000,
        1,
      );
      bucketMinutes = bucketMinutesFor(span, maxPoints);
      const width = bucketMinutes * 60_000;
      const buckets = new Map<number, typeof flagged>();
      for (const f of flagged) {
        const b = Math.floor(f.t / width) * width;
        const list2 = buckets.get(b) ?? [];
        list2.push(f);
        buckets.set(b, list2);
      }
      points = [...buckets.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([b, fs]) => {
          const vs = fs.map((f) => f.v);
          return {
            t: new Date(b).toISOString(),
            value: vs.reduce((a, c) => a + c, 0) / vs.length,
            min: Math.min(...vs),
            max: Math.max(...vs),
            out_of_range: fs.reduce((a, f) => a + f.out, 0),
          };
        });
    }

    const values = list.map((f) => f.v);
    const lastOut = [...flagged].reverse().find((f) => f.out);
    out[column] = {
      resolution,
      bucket_minutes: bucketMinutes,
      points,
      windows,
      total: values.length,
      below: flagged.filter((f) => f.side === 'below').length,
      above: flagged.filter((f) => f.side === 'above').length,
      counts,
      live_min: values.length ? values.reduce((a, b) => Math.min(a, b)) : null,
      live_max: values.length ? values.reduce((a, b) => Math.max(a, b)) : null,
      live_mean: values.length
        ? values.reduce((a, b) => a + b, 0) / values.length
        : null,
      last_out_of_range_at: lastOut ? new Date(lastOut.t).toISOString() : null,
    };
  }
  return out;
}
