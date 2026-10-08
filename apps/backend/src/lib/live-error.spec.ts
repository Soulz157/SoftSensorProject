import {
  computeLiveError,
  poolTruthStats,
  type TruthStats,
} from '@/lib/live-error';

/** Sums for one window's pairs, so a fixture reads as the pairs it means
 *  rather than as six numbers whose provenance is invisible. */
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

const NOTHING_JOINED: TruthStats = {
  n: 0,
  sumSe: 0,
  sumAe: 0,
  sumSigned: 0,
  sumActual: 0,
  sumActualSq: 0,
};

describe('poolTruthStats', () => {
  it('sums every window that carries pairs', () => {
    const pooled = poolTruthStats([
      statsFor([[41, 40]]),
      statsFor([
        [45, 44],
        [50, 52],
      ]),
    ]);

    expect(pooled.n).toBe(3);
    // residuals +1, +1, -2 -> signed 0, absolute 4, squared 1 + 1 + 4 = 6.
    expect(pooled.sumSigned).toBeCloseTo(0);
    expect(pooled.sumAe).toBeCloseTo(4);
    expect(pooled.sumSe).toBeCloseTo(6);
    expect(pooled.sumActual).toBeCloseTo(136);
  });

  it('SKIPS a window that joined nothing rather than adding its zeros', () => {
    const pooled = poolTruthStats([
      statsFor([[41, 40]]),
      NOTHING_JOINED,
      NOTHING_JOINED,
    ]);

    // n must count PAIRS, not windows — otherwise every unjoined window
    // dilutes the mean-based metrics toward zero.
    expect(pooled.n).toBe(1);
    expect(pooled.sumActual).toBeCloseTo(40);
  });

  it('is order-independent and associative, which is what makes it exact', () => {
    const a = statsFor([[41, 40]]);
    const b = statsFor([[45, 44]]);
    const c = statsFor([[50, 52]]);

    expect(poolTruthStats([poolTruthStats([c, a]), b])).toEqual(
      poolTruthStats([a, b, c]),
    );
  });
});

describe('computeLiveError', () => {
  it('returns null — NOT an error of zero — when no pairs exist', () => {
    expect(computeLiveError(NOTHING_JOINED)).toBeNull();
  });

  it('computes RMSE/MAE/bias from hand-checkable numbers', () => {
    // residuals: +1, +1, -2. n = 3.
    const result = computeLiveError(
      poolTruthStats([
        statsFor([
          [41, 40],
          [45, 44],
          [50, 52],
        ]),
      ]),
    );

    expect(result).not.toBeNull();
    expect(result!.n).toBe(3);
    expect(result!.rmse).toBeCloseTo(Math.sqrt(2), 10); // sqrt(6 / 3)
    expect(result!.mae).toBeCloseTo(4 / 3, 10);
    expect(result!.bias).toBeCloseTo(0, 10);
    // bias is 0 here, so SD collapses onto RMSE — the one case they agree.
    expect(result!.sd).toBeCloseTo(result!.rmse, 10);
  });

  it('separates SD from RMSE once the residuals carry a bias', () => {
    // residuals: +2, +2 -> RMSE 2, bias 2, SD 0 (no spread at all).
    const result = computeLiveError(
      poolTruthStats([
        statsFor([
          [42, 40],
          [46, 44],
        ]),
      ]),
    )!;

    expect(result.rmse).toBeCloseTo(2, 10);
    expect(result.bias).toBeCloseTo(2, 10);
    expect(result.sd).toBeCloseTo(0, 10);
  });

  it('uses the client residual sign convention (predicted - actual)', () => {
    const over = computeLiveError(poolTruthStats([statsFor([[41, 40]])]))!;
    const under = computeLiveError(poolTruthStats([statsFor([[39, 40]])]))!;

    expect(over.bias).toBeGreaterThan(0); // over-predicts
    expect(under.bias).toBeLessThan(0); // under-predicts
  });

  it('computes a POOLED r2 across windows, not an average of per-window r2s', () => {
    const windowA = statsFor([
      [41, 40],
      [45, 44],
    ]);
    const windowB = statsFor([
      [50, 52],
      [60, 61],
    ]);

    const pooledFromWindows = computeLiveError(
      poolTruthStats([windowA, windowB]),
    )!;
    const asOneSet = computeLiveError(
      poolTruthStats([
        statsFor([
          [41, 40],
          [45, 44],
          [50, 52],
          [60, 61],
        ]),
      ]),
    )!;

    // Pooling per-window sums must give exactly what scoring all four pairs
    // at once gives — that is the whole claim of this design.
    expect(pooledFromWindows.r2).toBeCloseTo(asOneSet.r2, 12);
    expect(pooledFromWindows.rmse).toBeCloseTo(asOneSet.rmse, 12);
  });

  it('reports r2 = 0 rather than dividing by zero on a constant actual series', () => {
    const result = computeLiveError(
      poolTruthStats([
        statsFor([
          [41, 40],
          [39, 40],
        ]),
      ]),
    )!;

    expect(result.r2).toBe(0);
    expect(result.rmse).toBeCloseTo(1, 10);
  });

  it('reports r2 = 0 for a single pair, where SS_tot is structurally zero', () => {
    const result = computeLiveError(poolTruthStats([statsFor([[41, 40]])]))!;

    expect(result.n).toBe(1);
    expect(result.r2).toBe(0);
    // The residual itself is still real and still published.
    expect(result.rmse).toBeCloseTo(1, 10);
    expect(result.bias).toBeCloseTo(1, 10);
  });

  /**
   * MODEL-SERVE-005-T03 live verification, pinned as a regression. These
   * six sums are the EXACT figures the real python join returned against
   * real MinIO and a real SQL lab source on 2026-09-14 (4 joined pairs:
   * 41.0/40.0, 41.5/41.0, 42.5/40.5, 43.5/42.0). Kept as literals rather
   * than recomputed from the pairs, so a future change to the join's own
   * arithmetic cannot quietly move both sides of this test together.
   */
  it('matches the live-verified sums from the real stack', () => {
    const result = computeLiveError({
      n: 4,
      sumSe: 7.5,
      sumAe: 5,
      sumSigned: 5,
      sumActual: 163.5,
      sumActualSq: 6685.25,
    })!;

    expect(result.rmse).toBeCloseTo(Math.sqrt(1.875), 10);
    expect(result.mae).toBeCloseTo(1.25, 10);
    expect(result.bias).toBeCloseTo(1.25, 10);
    expect(result.sd).toBeCloseTo(Math.sqrt(0.3125), 10);
    // SS_tot = 6685.25 - 163.5^2 / 4 = 2.1875; r2 = 1 - 7.5 / 2.1875.
    expect(result.r2).toBeCloseTo(1 - 7.5 / 2.1875, 10);
    // Negative: these four lab samples sit in a very narrow band, so the
    // mean of the actuals predicts them better than the model does. A real
    // number, published as-is rather than clamped.
    expect(result.r2).toBeLessThan(0);
  });

  it('produces a NEGATIVE r2 when the model is worse than the mean', () => {
    // Actuals 10 and 20 with the predictions inverted. A model can be worse
    // than predicting the average, and that must show as a negative number
    // rather than being clamped into a flattering range.
    const result = computeLiveError(
      poolTruthStats([
        statsFor([
          [20, 10],
          [10, 20],
        ]),
      ]),
    )!;

    expect(result.r2).toBeLessThan(0);
  });
});
