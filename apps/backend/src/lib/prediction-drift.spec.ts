import {
  computeDrift,
  estimateOutOfRangePct,
  poolFeatureStats,
  type ColumnBaselineMap,
  type DriftThresholds,
  type FeatureStatsMap,
} from './prediction-drift';

const THRESHOLDS: DriftThresholds = {
  warnSd: 1.5,
  criticalSd: 3.0,
  outOfRangePct: 10,
};

describe('poolFeatureStats', () => {
  it('sums n/sum/sumsq and takes extremes across multiple requests', () => {
    const inputs: FeatureStatsMap[] = [
      { 'TI202.PV': { n: 2, sum: 1.0, sumsq: 0.52, min: 0.4, max: 0.6 } },
      { 'TI202.PV': { n: 3, sum: 1.5, sumsq: 0.78, min: 0.3, max: 0.7 } },
    ];
    const pooled = poolFeatureStats(inputs);
    expect(pooled['TI202.PV']).toEqual({
      n: 5,
      sum: 2.5,
      sumsq: 1.3,
      min: 0.3,
      max: 0.7,
    });
  });

  it('skips a column with n<=0 rather than corrupting the pool with a zero', () => {
    const pooled = poolFeatureStats([
      { X: { n: 0, sum: 0, sumsq: 0, min: 0, max: 0 } },
      { X: { n: 2, sum: 4, sumsq: 8.02, min: 1.9, max: 2.1 } },
    ]);
    expect(pooled.X).toEqual({ n: 2, sum: 4, sumsq: 8.02, min: 1.9, max: 2.1 });
  });

  it('a column present in only one input still pools correctly', () => {
    const pooled = poolFeatureStats([
      { A: { n: 1, sum: 1, sumsq: 1, min: 1, max: 1 } },
      { B: { n: 1, sum: 2, sumsq: 4, min: 2, max: 2 } },
    ]);
    expect(Object.keys(pooled).sort()).toEqual(['A', 'B']);
  });
});

describe('estimateOutOfRangePct', () => {
  it('is ~0 when the live distribution sits well inside the baseline range', () => {
    // N(0.5, 0.05) against a [0.1, 0.9] baseline range — essentially all
    // mass is inside, so both tails should be negligible.
    const pct = estimateOutOfRangePct(0.5, 0.05, 0.1, 0.9);
    expect(pct).toBeLessThan(0.01);
  });

  it('is ~100 when the live distribution sits entirely outside the range', () => {
    // A tight live distribution centred FAR above the baseline's p99.
    const pct = estimateOutOfRangePct(10, 0.1, 0.1, 0.9);
    expect(pct).toBeGreaterThan(99);
  });

  it('is exactly 100 at a degenerate boundary where the range collapses to one point', () => {
    // Live == N(0.5, 1), baseline range [0.5, 0.5] — half the normal mass
    // lies below the (degenerate) lower bound, half above the (identical)
    // upper bound, summing to 100% by construction — confirms the two
    // tails are ADDED, not averaged.
    const pct = estimateOutOfRangePct(0.5, 1, 0.5, 0.5);
    expect(pct).toBeCloseTo(100, 5);
  });

  it('clamps into [0,100] rather than ever going negative or over 100', () => {
    const pct = estimateOutOfRangePct(0, 1, -1000, 1000);
    expect(pct).toBeGreaterThanOrEqual(0);
    expect(pct).toBeLessThanOrEqual(100);
  });
});

describe('computeDrift', () => {
  it('reports OK when live matches the training baseline', () => {
    const live: FeatureStatsMap = {
      'TI202.PV': { n: 100, sum: 50, sumsq: 26, min: 0.3, max: 0.7 },
    };
    const baseline: ColumnBaselineMap = {
      'TI202.PV': { mean: 0.5, std: 0.1, percentiles: { p1: 0.2, p99: 0.8 } },
    };
    const report = computeDrift(live, baseline, THRESHOLDS);
    expect(report.status).toBe('OK');
    expect(report.columns[0].status).toBe('OK');
    expect(report.columns[0].z).toBeCloseTo(0, 5);
  });

  it('reports CRITICAL when the live mean is far outside the training distribution (V01 shape)', () => {
    // Live mean shifted 10 training-SDs above the training mean.
    const trainMean = 0.5;
    const trainStd = 0.1;
    const liveMean = trainMean + 10 * trainStd;
    const live: FeatureStatsMap = {
      'TI202.PV': {
        n: 50,
        sum: liveMean * 50,
        sumsq: (liveMean * liveMean + 0.0001) * 50,
        min: liveMean - 0.01,
        max: liveMean + 0.01,
      },
    };
    const baseline: ColumnBaselineMap = {
      'TI202.PV': {
        mean: trainMean,
        std: trainStd,
        percentiles: { p1: 0.2, p99: 0.8 },
      },
    };
    const report = computeDrift(live, baseline, THRESHOLDS);
    expect(report.status).toBe('CRITICAL');
    expect(report.columns[0].status).toBe('CRITICAL');
    expect(Math.abs(report.columns[0].z as number)).toBeGreaterThanOrEqual(3.0);
  });

  it('reports UNKNOWN, not OK, for a column with no training baseline', () => {
    const live: FeatureStatsMap = {
      'NEW.PV': { n: 10, sum: 5, sumsq: 2.5, min: 0.4, max: 0.6 },
    };
    const report = computeDrift(live, {}, THRESHOLDS);
    expect(report.columns[0].status).toBe('UNKNOWN');
    expect(report.columns[0].reason).toMatch(/no training baseline/);
  });

  it('reports UNKNOWN, not a divide-by-zero, for a baseline with null/zero std', () => {
    const live: FeatureStatsMap = {
      'FIC114C.PV': { n: 10, sum: 5, sumsq: 2.5, min: 0.4, max: 0.6 },
    };
    const baseline: ColumnBaselineMap = {
      'FIC114C.PV': { mean: 0.5, std: null, percentiles: null },
    };
    const report = computeDrift(live, baseline, THRESHOLDS);
    expect(report.columns[0].status).toBe('UNKNOWN');
    expect(Number.isFinite(report.columns[0].z as number)).toBe(false);
  });

  it('does not compare a baseline-only column with no live counterpart (e.g. the target tag)', () => {
    const live: FeatureStatsMap = {
      'TI202.PV': { n: 10, sum: 5, sumsq: 2.5, min: 0.4, max: 0.6 },
    };
    const baseline: ColumnBaselineMap = {
      'TI202.PV': { mean: 0.5, std: 0.1, percentiles: { p1: 0.2, p99: 0.8 } },
      'S204FBP.lab': {
        mean: 1.0,
        std: 0.2,
        percentiles: { p1: 0.5, p99: 1.5 },
      },
    };
    const report = computeDrift(live, baseline, THRESHOLDS);
    expect(report.columns).toHaveLength(1);
    expect(report.columns[0].column).toBe('TI202.PV');
  });

  it('overall status is the worst column status, never masked by an UNKNOWN column', () => {
    const live: FeatureStatsMap = {
      OK_COL: { n: 10, sum: 5, sumsq: 2.5, min: 0.4, max: 0.6 },
      UNKNOWN_COL: { n: 10, sum: 5, sumsq: 2.5, min: 0.4, max: 0.6 },
      CRITICAL_COL: { n: 10, sum: 100, sumsq: 1000.1, min: 9.9, max: 10.1 },
    };
    const baseline: ColumnBaselineMap = {
      OK_COL: { mean: 0.5, std: 0.1, percentiles: { p1: 0.2, p99: 0.8 } },
      CRITICAL_COL: { mean: 0.5, std: 0.1, percentiles: { p1: 0.2, p99: 0.8 } },
    };
    const report = computeDrift(live, baseline, THRESHOLDS);
    expect(report.status).toBe('CRITICAL');
  });
});
