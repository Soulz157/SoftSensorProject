import {
  bucketValue,
  buildRowSeries,
  computeRangeDrift,
  gradeColumn,
  gradeSeries,
  poolHistograms,
  type DriftReference,
  type DriftThresholds,
  type SeriesColumnInput,
} from './input-range-drift';

/** MODEL-SERVE-036. Input drift by training range (replaces PSI). */

const T: DriftThresholds = {
  outOfRangeWarnPct: 5,
  outOfRangeCriticalPct: 20,
  minSamples: 30,
};

const REF: DriftReference = {
  binMode: 'continuous',
  binCount: 2,
  edges: [10, 15, 20],
  refCounts: [50, 50],
};

describe('poolHistograms', () => {
  it('sums counts/below/above elementwise and skips null rows', () => {
    expect(
      poolHistograms([
        { X: { counts: [1, 2], below: 1, above: 0 } },
        { X: null },
        { X: { counts: [3, 4], below: 0, above: 2 } },
      ]),
    ).toEqual({ X: { counts: [4, 6], below: 1, above: 2 } });
  });

  it('drops a histogram whose bin count differs rather than misaligning it', () => {
    expect(
      poolHistograms([
        { X: { counts: [1, 2], below: 0, above: 0 } },
        { X: { counts: [9], below: 5, above: 5 } },
      ]),
    ).toEqual({ X: { counts: [1, 2], below: 0, above: 0 } });
  });
});

describe('gradeColumn', () => {
  it('is UNKNOWN with no training range, never OK', () => {
    const c = gradeColumn(
      'X',
      { counts: [50], below: 0, above: 0 },
      undefined,
      T,
    );
    expect(c).toMatchObject({
      status: 'UNKNOWN',
      trainMin: null,
      trainMax: null,
      bins: null,
    });
    expect(c.reason).toMatch(/no training range/);
  });

  it('is INSUFFICIENT_DATA below the sample floor', () => {
    const c = gradeColumn(
      'X',
      { counts: [10, 10], below: 0, above: 5 },
      REF,
      T,
    );
    expect(c.status).toBe('INSUFFICIENT_DATA');
    expect(c.liveTotal).toBe(25);
  });

  it('grades the out-of-range share with >= at both cutoffs', () => {
    const at = (out: number) =>
      gradeColumn('X', { counts: [100 - out, 0], below: 0, above: out }, REF, T)
        .status;
    expect(at(4)).toBe('OK');
    expect(at(5)).toBe('WARN');
    expect(at(19)).toBe('WARN');
    expect(at(20)).toBe('CRITICAL');
  });

  it('every live value outside the range is CRITICAL (the case PSI read as OK)', () => {
    const c = gradeColumn('X', { counts: [0, 0], below: 0, above: 60 }, REF, T);
    expect(c).toMatchObject({ status: 'CRITICAL', outOfRangePct: 100 });
  });

  it('reports the training range as the outer reference edges', () => {
    const c = gradeColumn(
      'X',
      { counts: [50, 50], below: 0, above: 0 },
      REF,
      T,
    );
    expect(c).toMatchObject({ trainMin: 10, trainMax: 20, status: 'OK' });
    expect(c.bins?.edges).toBe(REF.edges);
  });

  it('is UNKNOWN when the live bins were counted against other edges', () => {
    const c = gradeColumn(
      'X',
      { counts: [1, 2, 3], below: 0, above: 40 },
      REF,
      T,
    );
    expect(c.status).toBe('UNKNOWN');
  });
});

describe('computeRangeDrift', () => {
  it('report status is the worst column, never masked by UNKNOWN', () => {
    const r = computeRangeDrift(
      {
        A: { counts: [50, 40], below: 0, above: 10 },
        B: { counts: [50, 50], below: 0, above: 0 },
        C: { counts: [50], below: 0, above: 0 },
      },
      { A: REF, B: REF },
      T,
    );
    expect(r.columns.map((c) => c.status)).toEqual(['WARN', 'OK', 'UNKNOWN']);
    expect(r.status).toBe('WARN');
  });
});

describe('bucketValue (mirror of softsensor_scaling.bucket_value)', () => {
  it('continuous: closed on the right, outside the edges is overflow', () => {
    expect(bucketValue(10, REF)).toEqual({ index: 0, overflow: null });
    expect(bucketValue(15, REF)).toEqual({ index: 1, overflow: null });
    expect(bucketValue(20, REF)).toEqual({ index: 1, overflow: null });
    expect(bucketValue(9.99, REF).overflow).toBe('below');
    expect(bucketValue(20.01, REF).overflow).toBe('above');
  });

  it('categorical: nearest state, overflow only past half the smallest gap', () => {
    const cat = { binMode: 'categorical' as const, edges: [0, 1, 2] };
    expect(bucketValue(2.4, cat)).toEqual({ index: 2, overflow: null });
    expect(bucketValue(2.6, cat).overflow).toBe('above');
    expect(bucketValue(-0.6, cat).overflow).toBe('below');
    // A single-value tag has no tolerance.
    expect(
      bucketValue(1.01, { binMode: 'categorical', edges: [1] }).overflow,
    ).toBe('above');
  });
});

describe('gradeSeries', () => {
  const col = (over: Partial<SeriesColumnInput>): SeriesColumnInput => ({
    resolution: 'raw',
    bucket_minutes: null,
    points: [],
    windows: [],
    total: 100,
    below: 0,
    above: 10,
    counts: [40, 50],
    live_min: 11,
    live_max: 25,
    live_mean: 16,
    last_out_of_range_at: null,
    ...over,
  });

  it('grades from the series counts and keeps an uncovered tag as UNKNOWN with its total', () => {
    const { report, series } = gradeSeries(
      { A: col({}), B: col({ counts: null, above: 0 }) },
      { A: REF },
      T,
    );
    const [a, b] = report.columns;
    expect(a).toMatchObject({
      status: 'WARN',
      outOfRangePct: 10,
      liveTotal: 100,
    });
    expect(b).toMatchObject({ status: 'UNKNOWN', liveTotal: 100 });
    expect(series.A).toMatchObject({ liveMin: 11, liveMax: 25 });
  });
});

describe('buildRowSeries (/predict plane)', () => {
  const rows = Array.from({ length: 120 }, (_, i) => ({
    timestamp: new Date(Date.UTC(2026, 0, 1, 5, i)).toISOString(),
    features: { X: i === 70 ? 30 : 12 },
  }));

  it('builds hourly windows newest first with their own counts', () => {
    const s = buildRowSeries(rows, { X: REF }, 600).X;
    expect(s.windows.map((w) => w.n)).toEqual([60, 60]);
    expect(s.windows[0]).toMatchObject({ above: 1, max: 30 });
    expect(s.counts).toEqual([119, 0]);
    expect(s.last_out_of_range_at).toBe('2026-01-01T06:10:00.000Z');
  });

  it('buckets past max points and keeps the spike in a bucket max', () => {
    const s = buildRowSeries(rows, { X: REF }, 50).X;
    expect(s.resolution).toBe('bucketed');
    expect(s.bucket_minutes).toBe(5);
    expect(s.points.length).toBeLessThanOrEqual(50);
    expect(Math.max(...s.points.map((p) => p.max))).toBe(30);
    expect(s.points.reduce((a, p) => a + p.out_of_range, 0)).toBe(1);
  });
});
