import {
  classifyResidualSd,
  MIN_RESIDUAL_SD_PAIRS,
  type ResidualSdThresholds,
} from '@/lib/residual-sd-health';
import type { TruthStats } from '@/lib/live-error';

/** Same helper shape as live-error.spec.ts: a fixture reads as the pairs it
 *  means rather than as six opaque sums. */
function statsFor(
  pairs: Array<[predicted: number, actual: number]>,
): TruthStats {
  return pairs.reduce<TruthStats>(
    (acc, [predicted, actual]) => {
      const residual = predicted - actual;
      return {
        n: acc.n + 1,
        sumSe: acc.sumSe + residual * residual,
        sumAe: acc.sumAe + Math.abs(residual),
        sumSigned: acc.sumSigned + residual,
        sumActual: acc.sumActual + actual,
        sumActualSq: acc.sumActualSq + actual * actual,
      };
    },
    { n: 0, sumSe: 0, sumAe: 0, sumSigned: 0, sumActual: 0, sumActualSq: 0 },
  );
}

const THRESHOLDS: ResidualSdThresholds = { warnSd: 1.5, criticalSd: 3.0 };

/**
 * `count` pairs whose residuals alternate ±`spread` around a moving actual.
 * The residual SD is then exactly `spread`, so a test can state the ratio it
 * expects instead of deriving it.
 */
function pairsWithSpread(spread: number, count = MIN_RESIDUAL_SD_PAIRS) {
  return statsFor(
    Array.from({ length: count }, (_, i): [number, number] => {
      const actual = 100 + i;
      return [actual + (i % 2 === 0 ? spread : -spread), actual];
    }),
  );
}

describe('classifyResidualSd', () => {
  it('is OK while the live spread matches the reference', () => {
    const verdict = classifyResidualSd({
      windows: [pairsWithSpread(2)],
      baselineSd: 2,
      thresholds: THRESHOLDS,
    });

    expect(verdict.status).toBe('OK');
    expect(verdict.ratio).toBeCloseTo(1);
    expect(verdict.liveSd).toBeCloseTo(2);
    expect(verdict.n).toBe(MIN_RESIDUAL_SD_PAIRS);
  });

  /**
   * THE TEST THE REJECTED DESIGNS FAIL. A rule that measures residuals
   * against an SD recomputed from those same residuals — or that counts the
   * share of points outside their own ±k·SD bands — returns an identical
   * verdict for both halves of this test, because both quantities are
   * scale-invariant. The reference SD is what makes error growth visible.
   */
  it('DETECTS a tenfold error growth against a frozen reference', () => {
    const baselineSd = 2;
    const healthy = classifyResidualSd({
      windows: [pairsWithSpread(2)],
      baselineSd,
      thresholds: THRESHOLDS,
    });
    const degraded = classifyResidualSd({
      windows: [pairsWithSpread(20)],
      baselineSd,
      thresholds: THRESHOLDS,
    });

    expect(healthy.status).toBe('OK');
    expect(degraded.status).toBe('ALERT');
    expect(degraded.ratio).toBeCloseTo(10);
  });

  it('warns between warnSd and criticalSd', () => {
    const verdict = classifyResidualSd({
      windows: [pairsWithSpread(4)],
      baselineSd: 2,
      thresholds: THRESHOLDS,
    });

    expect(verdict.status).toBe('WARN');
    expect(verdict.ratio).toBeCloseTo(2);
  });

  it('treats each threshold as inclusive at its exact boundary', () => {
    const atWarn = classifyResidualSd({
      windows: [pairsWithSpread(3)],
      baselineSd: 2,
      thresholds: THRESHOLDS,
    });
    const atCritical = classifyResidualSd({
      windows: [pairsWithSpread(6)],
      baselineSd: 2,
      thresholds: THRESHOLDS,
    });

    expect(atWarn.status).toBe('WARN');
    expect(atCritical.status).toBe('ALERT');
  });

  it('stays OK when the model is BETTER than its reference — the test is one-sided', () => {
    const verdict = classifyResidualSd({
      windows: [pairsWithSpread(0.5)],
      baselineSd: 2,
      thresholds: THRESHOLDS,
    });

    expect(verdict.status).toBe('OK');
    expect(verdict.ratio).toBeCloseTo(0.25);
  });

  it('is UNKNOWN, never OK, with no reference SD', () => {
    const verdict = classifyResidualSd({
      windows: [pairsWithSpread(20)],
      baselineSd: null,
      thresholds: THRESHOLDS,
    });

    expect(verdict.status).toBe('UNKNOWN');
    expect(verdict.ratio).toBeNull();
  });

  it('is UNKNOWN on a zero reference SD rather than dividing by it', () => {
    const verdict = classifyResidualSd({
      windows: [pairsWithSpread(20)],
      baselineSd: 0,
      thresholds: THRESHOLDS,
    });

    expect(verdict.status).toBe('UNKNOWN');
    expect(verdict.ratio).toBeNull();
  });

  it('is UNKNOWN when no ground truth has joined', () => {
    const verdict = classifyResidualSd({
      windows: [],
      baselineSd: 2,
      thresholds: THRESHOLDS,
    });

    expect(verdict.status).toBe('UNKNOWN');
    expect(verdict.liveSd).toBeNull();
    expect(verdict.n).toBe(0);
  });

  it('REFUSES to raise on a sample below the minimum, however bad it looks', () => {
    const verdict = classifyResidualSd({
      windows: [pairsWithSpread(50, MIN_RESIDUAL_SD_PAIRS - 1)],
      baselineSd: 2,
      thresholds: THRESHOLDS,
    });

    expect(verdict.status).toBe('UNKNOWN');
    // The spread is still reported — the refusal is about the VERDICT, not
    // about hiding the figure from a reader. Loose precision because an ODD
    // pair count leaves the alternating residuals with a small non-zero mean,
    // so the SD lands a hair under the nominal spread.
    expect(verdict.liveSd).toBeCloseTo(50, 0);
    expect(verdict.n).toBe(MIN_RESIDUAL_SD_PAIRS - 1);
  });

  it('pools windows rather than judging them one at a time', () => {
    const half = Math.ceil(MIN_RESIDUAL_SD_PAIRS / 2);
    const verdict = classifyResidualSd({
      windows: [pairsWithSpread(8, half), pairsWithSpread(8, half)],
      baselineSd: 2,
      thresholds: THRESHOLDS,
    });

    expect(verdict.n).toBe(half * 2);
    expect(verdict.status).toBe('ALERT');
  });

  it('measures SPREAD, not offset — a biased but consistent model is not an SD fault', () => {
    // Every residual is exactly +20: a large, systematic over-prediction
    // with ZERO spread. This axis reports OK, correctly; a constant offset
    // is a different fault with a different fix, and naming it here would
    // put two faults under one reason code.
    const windows = statsFor(
      Array.from(
        { length: MIN_RESIDUAL_SD_PAIRS },
        (_, i): [number, number] => [100 + i + 20, 100 + i],
      ),
    );
    const verdict = classifyResidualSd({
      windows: [windows],
      baselineSd: 2,
      thresholds: THRESHOLDS,
    });

    expect(verdict.liveSd).toBeCloseTo(0);
    expect(verdict.status).toBe('OK');
  });
});
