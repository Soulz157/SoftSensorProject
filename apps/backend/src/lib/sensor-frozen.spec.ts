import { detectFrozenColumns } from './sensor-frozen';
import type { ColumnBaselineMap, FeatureStatsMap } from './prediction-drift';

/** A window where every named column sat at exactly `value`. `n` well above
 *  the 2-row floor so guard (4) is not what any of these cases is testing. */
function flatAt(values: Record<string, number>, n = 20): FeatureStatsMap {
  const out: FeatureStatsMap = {};
  for (const [column, v] of Object.entries(values)) {
    out[column] = { n, sum: v * n, sumsq: v * v * n, min: v, max: v };
  }
  return out;
}

/** A window where the column genuinely moved between `min` and `max`. */
function movingBetween(
  column: string,
  min: number,
  max: number,
  n = 20,
): FeatureStatsMap {
  const mid = (min + max) / 2;
  return {
    [column]: { n, sum: mid * n, sumsq: mid * mid * n, min, max },
  };
}

/** A tag that MOVED in training — std well above zero. The only kind guard
 *  (1) lets through. */
const trained: ColumnBaselineMap = {
  MOVER: { mean: 0.5, std: 0.3, percentiles: { p1: 0, p99: 1 } },
};

describe('detectFrozenColumns (MODEL-SERVE-001-T29/V21)', () => {
  it('badges a genuinely stuck tag across the full window set', () => {
    const frozen = detectFrozenColumns({
      windows: [
        flatAt({ MOVER: 0.2 }),
        flatAt({ MOVER: 0.2 }),
        flatAt({ MOVER: 0.2 }),
      ],
      baseline: trained,
      frozenWindows: 3,
      frozenTolerancePct: 0,
    });
    expect(frozen).toEqual(['MOVER']);
  });

  /**
   * V21's stated "more important half". A fixture containing only a stuck
   * tag passes against an implementation that badges every zero-range
   * column — which would mark every setpoint and held-closed valve frozen
   * forever, on a plant where nothing is wrong.
   */
  it('does NOT badge a tag that was already flat in TRAINING', () => {
    const flatInTraining: ColumnBaselineMap = {
      SETPOINT: { mean: 50, std: 0, percentiles: { p1: 50, p99: 50 } },
    };
    const frozen = detectFrozenColumns({
      windows: [
        flatAt({ SETPOINT: 50 }),
        flatAt({ SETPOINT: 50 }),
        flatAt({ SETPOINT: 50 }),
      ],
      baseline: flatInTraining,
      frozenWindows: 3,
      frozenTolerancePct: 0,
    });
    expect(frozen).toEqual([]);
  });

  it('separates the two in ONE fixture — the stuck tag is badged, the training-flat one is not', () => {
    // Both are zero-range live. Only the baseline tells them apart, which is
    // the whole point of guard (1).
    const baseline: ColumnBaselineMap = {
      MOVER: { mean: 0.5, std: 0.3, percentiles: { p1: 0, p99: 1 } },
      SETPOINT: { mean: 50, std: 0, percentiles: { p1: 50, p99: 50 } },
    };
    const window = flatAt({ MOVER: 0.2, SETPOINT: 50 });
    const frozen = detectFrozenColumns({
      windows: [window, window, window],
      baseline,
      frozenWindows: 3,
      frozenTolerancePct: 0,
    });
    expect(frozen).toEqual(['MOVER']);
  });

  it('does NOT badge a tag that moved within the same three windows', () => {
    const frozen = detectFrozenColumns({
      windows: [
        movingBetween('MOVER', 0.1, 0.9),
        flatAt({ MOVER: 0.2 }),
        flatAt({ MOVER: 0.2 }),
      ],
      baseline: trained,
      frozenWindows: 3,
      frozenTolerancePct: 0,
    });
    expect(frozen).toEqual([]);
  });

  it('works in SCALED units, including genuinely negative values', () => {
    // T17 measured a real scaled value of -1.17 on a window falling outside
    // the trained range. Nothing here may assume [0, 1].
    const frozen = detectFrozenColumns({
      windows: [
        flatAt({ MOVER: -1.17 }),
        flatAt({ MOVER: -1.17 }),
        flatAt({ MOVER: -1.17 }),
      ],
      baseline: trained,
      frozenWindows: 3,
      frozenTolerancePct: 0,
    });
    expect(frozen).toEqual(['MOVER']);
  });

  it('does not badge a negative-range tag that is still moving', () => {
    const frozen = detectFrozenColumns({
      windows: [
        movingBetween('MOVER', -1.17, -0.4),
        flatAt({ MOVER: -1.17 }),
        flatAt({ MOVER: -1.17 }),
      ],
      baseline: trained,
      frozenWindows: 3,
      frozenTolerancePct: 0,
    });
    expect(frozen).toEqual([]);
  });

  it('skips a window below the row floor rather than reading it as flat', () => {
    // A one-row window is flat by construction — guard (4)'s whole concern.
    const frozen = detectFrozenColumns({
      windows: [
        flatAt({ MOVER: 0.2 }, 1),
        flatAt({ MOVER: 0.2 }),
        flatAt({ MOVER: 0.2 }),
      ],
      baseline: trained,
      frozenWindows: 3,
      frozenTolerancePct: 0,
    });
    expect(frozen).toEqual([]);
  });

  it('still evaluates a THIN window above the floor — the thin-but-stuck plant T29 wants caught', () => {
    // The floor is 2, NOT the schedule's minRows. A SKIPPED window (too few
    // rows to score) still carries featureStats, and a quiet plant going
    // stuck is exactly the case worth catching.
    const frozen = detectFrozenColumns({
      windows: [
        flatAt({ MOVER: 0.2 }, 2),
        flatAt({ MOVER: 0.2 }, 3),
        flatAt({ MOVER: 0.2 }, 2),
      ],
      baseline: trained,
      frozenWindows: 3,
      frozenTolerancePct: 0,
    });
    expect(frozen).toEqual(['MOVER']);
  });

  it('skips a column ABSENT from one window — absence is not flatness', () => {
    // A tag whose scaler is not "none" and which has no scalingParams entry
    // is excluded from featureStats entirely. That means "not measured
    // here", never "not moving".
    const frozen = detectFrozenColumns({
      windows: [{}, flatAt({ MOVER: 0.2 }), flatAt({ MOVER: 0.2 })],
      baseline: trained,
      frozenWindows: 3,
      frozenTolerancePct: 0,
    });
    expect(frozen).toEqual([]);
  });

  it('returns nothing when fewer windows exist than the setting asks for', () => {
    // Not enough evidence to say anything — never the same as "nothing
    // moved".
    const frozen = detectFrozenColumns({
      windows: [flatAt({ MOVER: 0.2 }), flatAt({ MOVER: 0.2 })],
      baseline: trained,
      frozenWindows: 3,
      frozenTolerancePct: 0,
    });
    expect(frozen).toEqual([]);
  });

  it('returns nothing when the baseline is empty — it cannot apply guard (1)', () => {
    // An empty baseline means the column_stats read failed or the artifact
    // has none. Badging every zero-range column there is the dark-ship
    // direction; reporting nothing is the honest one.
    const frozen = detectFrozenColumns({
      windows: [
        flatAt({ MOVER: 0.2 }),
        flatAt({ MOVER: 0.2 }),
        flatAt({ MOVER: 0.2 }),
      ],
      baseline: {},
      frozenWindows: 3,
      frozenTolerancePct: 0,
    });
    expect(frozen).toEqual([]);
  });

  it('honours frozenWindows as a WINDOW count, ignoring windows beyond it', () => {
    // The two most recent windows are stuck; the third (older) one moved.
    // At frozenWindows: 2 that is frozen; at 3 it is not.
    const windows = [
      flatAt({ MOVER: 0.2 }),
      flatAt({ MOVER: 0.2 }),
      movingBetween('MOVER', 0.1, 0.9),
    ];
    expect(
      detectFrozenColumns({
        windows,
        baseline: trained,
        frozenWindows: 2,
        frozenTolerancePct: 0,
      }),
    ).toEqual(['MOVER']);
    expect(
      detectFrozenColumns({
        windows,
        baseline: trained,
        frozenWindows: 3,
        frozenTolerancePct: 0,
      }),
    ).toEqual([]);
  });

  describe('frozenTolerancePct — a fraction of the TRAINING range', () => {
    it('badges a barely-moving tag once tolerance is a fraction of that range', () => {
      // Training range (p99-p1) is 1.0, so 5% tolerance is 0.05. A live
      // range of 0.02 is inside it.
      const frozen = detectFrozenColumns({
        windows: [
          movingBetween('MOVER', 0.2, 0.22),
          flatAt({ MOVER: 0.21 }),
          flatAt({ MOVER: 0.21 }),
        ],
        baseline: trained,
        frozenWindows: 3,
        frozenTolerancePct: 0.05,
      });
      expect(frozen).toEqual(['MOVER']);
    });

    it('does not badge the same movement when it exceeds the tolerance', () => {
      const frozen = detectFrozenColumns({
        windows: [
          movingBetween('MOVER', 0.2, 0.4),
          flatAt({ MOVER: 0.21 }),
          flatAt({ MOVER: 0.21 }),
        ],
        baseline: trained,
        frozenWindows: 3,
        frozenTolerancePct: 0.05,
      });
      expect(frozen).toEqual([]);
    });

    it('scales with the column — the same percentage means the same thing on a wide tag', () => {
      // Training range 400. 5% is 20, so a live range of 10 is frozen here
      // while the identical 10 would be enormous on the [0,1] tag above.
      const wide: ColumnBaselineMap = {
        WIDE: { mean: 200, std: 60, percentiles: { p1: 0, p99: 400 } },
      };
      const frozen = detectFrozenColumns({
        windows: [
          movingBetween('WIDE', 100, 110),
          flatAt({ WIDE: 105 }),
          flatAt({ WIDE: 105 }),
        ],
        baseline: wide,
        frozenWindows: 3,
        frozenTolerancePct: 0.05,
      });
      expect(frozen).toEqual(['WIDE']);
    });

    it('skips a column with no percentile range rather than silently applying exact-flatness', () => {
      // A non-zero tolerance was configured but cannot be expressed. Falling
      // back to 0 would apply a STRICTER rule than the operator asked for,
      // without saying so.
      const noPercentiles: ColumnBaselineMap = {
        MOVER: { mean: 0.5, std: 0.3, percentiles: null },
      };
      const frozen = detectFrozenColumns({
        windows: [
          flatAt({ MOVER: 0.2 }),
          flatAt({ MOVER: 0.2 }),
          flatAt({ MOVER: 0.2 }),
        ],
        baseline: noPercentiles,
        frozenWindows: 3,
        frozenTolerancePct: 0.05,
      });
      expect(frozen).toEqual([]);
    });
  });
});
