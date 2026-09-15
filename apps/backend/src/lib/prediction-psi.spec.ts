import {
  computeDrift,
  type ColumnBaselineMap,
  type FeatureStatsMap,
} from './prediction-drift';
import {
  computePsi,
  poolHistograms,
  type FeatureHistogramMap,
  type PsiReferenceMap,
  type PsiThresholds,
} from './prediction-psi';

const THRESHOLDS: PsiThresholds = {
  warn: 0.1,
  critical: 0.25,
  minSamplesPerBin: 20,
};

describe('poolHistograms', () => {
  it('sums counts/below/above elementwise across multiple requests', () => {
    const inputs: FeatureHistogramMap[] = [
      { 'TI202.PV': { counts: [1, 2, 3], below: 0, above: 1 } },
      { 'TI202.PV': { counts: [4, 5, 6], below: 1, above: 0 } },
    ];
    const pooled = poolHistograms(inputs);
    expect(pooled['TI202.PV']).toEqual({
      counts: [5, 7, 9],
      below: 1,
      above: 1,
    });
  });

  it('a column present in only one input still pools correctly', () => {
    const pooled = poolHistograms([
      { A: { counts: [1], below: 0, above: 0 } },
      { B: { counts: [2], below: 0, above: 0 } },
    ]);
    expect(Object.keys(pooled).sort()).toEqual(['A', 'B']);
  });

  it('drops a mismatched-bin-count column from the later input rather than corrupting the pool', () => {
    const pooled = poolHistograms([
      { X: { counts: [1, 2, 3], below: 0, above: 0 } },
      { X: { counts: [9, 9], below: 0, above: 0 } }, // different edge set
    ]);
    // The FIRST input's histogram survives untouched — the mismatched one
    // is skipped, never summed against a different bin count.
    expect(pooled.X).toEqual({ counts: [1, 2, 3], below: 0, above: 0 });
  });

  it('skips a null histogram (a request whose descriptor carried no PSI reference)', () => {
    const pooled = poolHistograms([
      { X: null, Y: { counts: [1], below: 0, above: 0 } },
    ]);
    expect(Object.keys(pooled)).toEqual(['Y']);
  });
});

describe('computePsi', () => {
  it('reports UNKNOWN, not OK, for a column with no reference', () => {
    const live: FeatureHistogramMap = {
      'NEW.PV': { counts: [100], below: 0, above: 0 },
    };
    const report = computePsi(live, {}, THRESHOLDS);
    expect(report.columns[0].status).toBe('UNKNOWN');
    expect(report.columns[0].psi).toBeNull();
    expect(report.columns[0].reason).toMatch(/no training reference/);
    // T16: `bins` is null EXACTLY when status is UNKNOWN — there is no
    // reference to show bins for.
    expect(report.columns[0].bins).toBeNull();
  });

  it('reports UNKNOWN when the live histogram bin count does not match the reference', () => {
    const live: FeatureHistogramMap = {
      X: { counts: [10, 10], below: 0, above: 0 },
    };
    const reference: PsiReferenceMap = {
      X: {
        binMode: 'continuous',
        binCount: 3,
        edges: [0, 1, 2, 3],
        refCounts: [10, 10, 10],
      },
    };
    const report = computePsi(live, reference, THRESHOLDS);
    expect(report.columns[0].status).toBe('UNKNOWN');
    expect(report.columns[0].reason).toMatch(/bin count does not match/);
    // T16: this is the OTHER UNKNOWN branch — a reference exists, but is
    // bin-count-incompatible with the live histogram. `bins` is still null:
    // there is no self-consistent bin shape to hand back.
    expect(report.columns[0].bins).toBeNull();
  });

  it('reports INSUFFICIENT_DATA, never a numeric PSI, below binCount * minSamplesPerBin', () => {
    // binCount=5, floor = 5*20 = 100. Only 19 live samples.
    const live: FeatureHistogramMap = {
      X: { counts: [4, 4, 4, 4, 3], below: 0, above: 0 },
    };
    const reference: PsiReferenceMap = {
      X: {
        binMode: 'continuous',
        binCount: 5,
        edges: [0, 1, 2, 3, 4, 5],
        refCounts: [100, 100, 100, 100, 100],
      },
    };
    const report = computePsi(live, reference, THRESHOLDS);
    expect(report.columns[0].status).toBe('INSUFFICIENT_DATA');
    expect(report.columns[0].psi).toBeNull();
    expect(report.columns[0].liveTotal).toBe(19);
    expect(report.columns[0].reason).toMatch(/below 100/);
    // T16: `bins` is POPULATED here, deliberately — a below-floor tag still
    // has a real reference and a real (if too-small) live pool, and a
    // reader needs these to print "19 of 100 rows" rather than a bare
    // "insufficient data" with no shape to it. NEVER a license to draw a
    // chart below the floor (T13's own words) — the caller enforces that,
    // not this module.
    expect(report.columns[0].bins).not.toBeNull();
    expect(report.columns[0].bins?.minSamples).toBe(100);
    expect(report.columns[0].bins?.liveInRangeTotal).toBe(19);
    expect(report.columns[0].bins?.binCount).toBe(5);
  });

  it('reports OK when the live histogram matches the reference proportions exactly', () => {
    const reference: PsiReferenceMap = {
      X: {
        binMode: 'continuous',
        binCount: 5,
        edges: [0, 1, 2, 3, 4, 5],
        refCounts: [100, 100, 100, 100, 100],
      },
    };
    const live: FeatureHistogramMap = {
      // Same proportions as the reference, scaled up — well past the
      // 5*20=100 sample floor.
      X: { counts: [200, 200, 200, 200, 200], below: 0, above: 0 },
    };
    const report = computePsi(live, reference, THRESHOLDS);
    expect(report.columns[0].status).toBe('OK');
    expect(report.columns[0].psi).toBeCloseTo(0, 5);
  });

  it('reports a real outOfRangePct for live mass outside the trained edges, without folding it into psi', () => {
    const reference: PsiReferenceMap = {
      X: {
        binMode: 'continuous',
        binCount: 2,
        edges: [0, 5, 10],
        refCounts: [100, 100],
      },
    };
    const live: FeatureHistogramMap = {
      // 180 in-range (matching reference proportions) + 20 above -> 10%
      // out of range, well past the 2*20=40 floor.
      X: { counts: [90, 90], below: 0, above: 20 },
    };
    const report = computePsi(live, reference, THRESHOLDS);
    expect(report.columns[0].outOfRangePct).toBeCloseTo(10, 5);
    expect(report.columns[0].psi).toBeCloseTo(0, 5); // in-range shape unchanged

    // T16: ONE fact, one representation — `outOfRangePct` and
    // `bins.below`/`bins.above` are the same measurement. A drill-down
    // must derive its display from the raw counts directly, never
    // recompute a second percentage that could silently diverge from this
    // one. `liveTotal` (200) is `counts` (180) + below (0) + above (20).
    const { bins, liveTotal } = report.columns[0];
    expect(bins?.liveInRangeTotal).toBe(180); // EXCLUDES below/above
    expect(bins?.below).toBe(0);
    expect(bins?.above).toBe(20);
    expect(report.columns[0].outOfRangePct).toBeCloseTo(
      ((bins!.below + bins!.above) / liveTotal) * 100,
      10,
    );
  });

  it('does not compare a reference-only column with no live counterpart', () => {
    const live: FeatureHistogramMap = {
      X: { counts: [100], below: 0, above: 0 },
    };
    const reference: PsiReferenceMap = {
      X: { binMode: 'categorical', binCount: 1, edges: [0], refCounts: [100] },
      Y: { binMode: 'categorical', binCount: 1, edges: [0], refCounts: [50] },
    };
    const report = computePsi(live, reference, THRESHOLDS);
    expect(report.columns).toHaveLength(1);
    expect(report.columns[0].column).toBe('X');
  });

  it('overall status is the worst column status, never masked by UNKNOWN or INSUFFICIENT_DATA', () => {
    const live: FeatureHistogramMap = {
      OK_COL: { counts: [100, 100], below: 0, above: 0 },
      UNKNOWN_COL: { counts: [100], below: 0, above: 0 },
      CRITICAL_COL: { counts: [1000, 0], below: 0, above: 0 },
    };
    const reference: PsiReferenceMap = {
      OK_COL: {
        binMode: 'continuous',
        binCount: 2,
        edges: [0, 1, 2],
        refCounts: [100, 100],
      },
      CRITICAL_COL: {
        binMode: 'continuous',
        binCount: 2,
        edges: [0, 1, 2],
        refCounts: [500, 500],
      },
    };
    const report = computePsi(live, reference, THRESHOLDS);
    expect(report.status).toBe('CRITICAL');
  });

  // ── V16: PSI catches a shape change the z-score cannot ──────────────────

  it('V16: same mean, different shape (bimodal) — z-score stays low while PSI rises', () => {
    // Reference: a tight unimodal population centred on 50, spread 0-100.
    // 10 equal-frequency bins, each holding 100 training points.
    const refEdges = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
    const reference: PsiReferenceMap = {
      X: {
        binMode: 'continuous',
        binCount: 10,
        edges: refEdges,
        refCounts: [100, 100, 100, 100, 100, 100, 100, 100, 100, 100],
      },
    };
    // Live: BIMODAL — clustered at the two extremes (bins 0 and 9), empty
    // in the middle. Same overall mean (~50) as a uniform spread would
    // give, but a completely different shape.
    const liveCounts = [400, 0, 0, 0, 0, 0, 0, 0, 0, 400];
    const live: FeatureHistogramMap = {
      X: { counts: liveCounts, below: 0, above: 0 },
    };

    // z-score side: reconstruct the same live population's mean/std as
    // computeDrift would see it, using bin MIDPOINTS as a stand-in for the
    // underlying values (400 points at bin0's midpoint=5, 400 at bin9's
    // midpoint=95 — mean is exactly 50, matching the reference mean).
    const liveStats: FeatureStatsMap = {
      X: {
        n: 800,
        sum: 400 * 5 + 400 * 95,
        sumsq: 400 * 5 * 5 + 400 * 95 * 95,
        min: 5,
        max: 95,
      },
    };
    const baseline: ColumnBaselineMap = {
      X: { mean: 50, std: 28.87, percentiles: { p1: 1, p99: 99 } }, // ~Uniform(0,100) std
    };
    const driftReport = computeDrift(liveStats, baseline, {
      warnSd: 1.5,
      criticalSd: 3.0,
      outOfRangePct: 10,
    });

    const psiReport = computePsi(live, reference, THRESHOLDS);

    // The demonstration, precisely: the Z-SCORE ITSELF stays at exactly 0
    // (same mean as training — z is blind to shape by construction), while
    // PSI rises to CRITICAL. Asserted against `z` directly, not against
    // `computeDrift`'s bundled overall status — that status ALSO folds in
    // a separate estimate (`outOfRangePct`, a parametric guess assuming
    // the live population is itself normally distributed) which, measured
    // here, happens to read WARN for this exact bimodal fixture via ITS
    // own different, cruder mechanism (a bimodal population's std is wide
    // enough to look tail-heavy against a normal model). That is real,
    // separately-measured behaviour, not a flaw in this fixture — but it
    // is a different signal from z, so asserting the bundled status here
    // would misrepresent which metric is actually being contrasted.
    expect(driftReport.columns[0].z as number).toBeCloseTo(0, 10);
    expect(psiReport.columns[0].psi as number).toBeGreaterThan(
      THRESHOLDS.critical,
    );
    expect(psiReport.columns[0].status).toBe('CRITICAL');
  });

  it('V16: identical distribution shape reports near-zero PSI (negative control for the bimodal case above)', () => {
    const refEdges = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
    const reference: PsiReferenceMap = {
      X: {
        binMode: 'continuous',
        binCount: 10,
        edges: refEdges,
        refCounts: [100, 100, 100, 100, 100, 100, 100, 100, 100, 100],
      },
    };
    const live: FeatureHistogramMap = {
      X: {
        counts: [80, 80, 80, 80, 80, 80, 80, 80, 80, 80],
        below: 0,
        above: 0,
      },
    };
    const report = computePsi(live, reference, THRESHOLDS);
    expect(report.columns[0].psi as number).toBeCloseTo(0, 5);
    expect(report.columns[0].status).toBe('OK');
  });

  it('V16: the frozen reference edges/refCounts are used byte-for-byte, never mutated or re-derived', () => {
    // computePsi never re-bins anything — it consumes the caller-supplied
    // frozen reference as-is. Asserting the object is untouched after the
    // call is the contract-level proof that no re-binning happened as a
    // side effect.
    const frozenEdges = [1.23456, 7.891011];
    const frozenRefCounts = [50];
    const reference: PsiReferenceMap = {
      X: {
        binMode: 'continuous',
        binCount: 1,
        edges: frozenEdges,
        refCounts: frozenRefCounts,
      },
    };
    const live: FeatureHistogramMap = {
      X: { counts: [50], below: 0, above: 0 },
    };
    const report = computePsi(live, reference, THRESHOLDS);
    expect(reference.X?.edges).toBe(frozenEdges);
    expect(reference.X?.refCounts).toBe(frozenRefCounts);
    expect(reference.X?.edges).toEqual([1.23456, 7.891011]);

    // T16: `ColumnBins.edges`/`refCounts` are the SAME array reference the
    // caller passed in `reference` — echoed, never copied or re-derived.
    // This is the object-identity proof a drill-down's edges are actually
    // the frozen training-time values, not a read-time reconstruction.
    expect(report.columns[0].bins?.edges).toBe(frozenEdges);
    expect(report.columns[0].bins?.refCounts).toBe(frozenRefCounts);
    expect(report.columns[0].bins?.liveCounts).toBe(live.X?.counts);
  });
});
