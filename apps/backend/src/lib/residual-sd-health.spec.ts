import {
  classifyResidualPoints,
  RESIDUAL_POINT_HOURS,
  RESIDUAL_POINT_STALE_HOURS,
  type ResidualPointWindow,
  type ResidualSdThresholds,
} from '@/lib/residual-sd-health';

const HOUR = 60 * 60 * 1000;
const NOW = new Date('2026-11-03T12:00:00.000Z');
const THRESHOLDS: ResidualSdThresholds = { warnSd: 2, criticalSd: 3 };

/** A joined window `hoursAgo` before NOW whose worst residual is `max`. */
function window(hoursAgo: number, max: number, n = 1): ResidualPointWindow {
  return {
    windowStart: new Date(NOW.getTime() - hoursAgo * HOUR),
    n,
    maxAbsResidual: max,
  };
}

const classify = (
  windows: ResidualPointWindow[],
  baselineSd: number | null = 10,
  thresholds = THRESHOLDS,
) => classifyResidualPoints({ windows, baselineSd, thresholds, now: NOW });

describe('classifyResidualPoints (MODEL-SERVE-046)', () => {
  it('is OK while the worst point stays inside 2 SD', () => {
    const verdict = classify([window(30, 15)]);
    expect(verdict).toMatchObject({
      status: 'OK',
      worstAbsResidual: 15,
      ratio: 1.5,
      baselineSd: 10,
    });
  });

  it('warns beyond 2 SD and alerts beyond 3 SD', () => {
    expect(classify([window(30, 21)]).status).toBe('WARN');
    expect(classify([window(30, 31)]).status).toBe('ALERT');
  });

  it('treats a point exactly ON a guard line as inside it', () => {
    expect(classify([window(30, 20)]).status).toBe('OK');
    expect(classify([window(30, 30)]).status).toBe('WARN');
  });

  it('lets ONE bad point decide, however many good ones surround it', () => {
    const verdict = classify([
      window(30, 3, 20),
      window(29, 35, 1),
      window(28, 2, 20),
    ]);
    expect(verdict.status).toBe('ALERT');
    expect(verdict.n).toBe(41);
  });

  it('judges the latest 24 h counted back from the newest JOINED window, not from now', () => {
    // The newest joined window is 30 h old (the join runs a lag after the
    // window), so a cut at now-24h would be empty and the axis UNKNOWN forever.
    const verdict = classify([
      window(30, 5),
      window(30 + RESIDUAL_POINT_HOURS - 1, 5),
    ]);
    expect(verdict.status).toBe('OK');
    expect(verdict.n).toBe(2);
  });

  it('ignores a bad point older than 24 h before the newest joined window', () => {
    const verdict = classify([
      window(30, 5),
      window(30 + RESIDUAL_POINT_HOURS + 1, 99),
    ]);
    expect(verdict.status).toBe('OK');
    expect(verdict.worstAbsResidual).toBe(5);
  });

  it('is UNKNOWN, never OK, with no reference SD or a zero one', () => {
    expect(classify([window(30, 5)], null).status).toBe('UNKNOWN');
    expect(classify([window(30, 5)], 0).status).toBe('UNKNOWN');
  });

  it('is UNKNOWN when no ground truth has joined', () => {
    expect(classify([]).status).toBe('UNKNOWN');
    expect(classify([window(30, 0, 0)]).status).toBe('UNKNOWN');
  });

  it('is UNKNOWN once the newest evidence is stale', () => {
    const verdict = classify([window(RESIDUAL_POINT_STALE_HOURS + 1, 99)]);
    expect(verdict.status).toBe('UNKNOWN');
  });

  it('follows the schedule thresholds, not a hard-coded 2 and 3', () => {
    const tight = { warnSd: 1, criticalSd: 1.5 };
    expect(classify([window(30, 12)], 10, tight).status).toBe('WARN');
    expect(classify([window(30, 16)], 10, tight).status).toBe('ALERT');
  });

  describe('held-deviation fallback', () => {
    const held = { worstAbsResidual: 35 };

    it('grades the held deviation while no pair has joined', () => {
      const verdict = classifyResidualPoints({
        windows: [],
        baselineSd: 10,
        thresholds: THRESHOLDS,
        heldFallback: held,
        now: NOW,
      });
      expect(verdict).toMatchObject({
        status: 'ALERT',
        ratio: 3.5,
        basis: 'held',
        n: 0,
      });
    });

    it('is ignored the moment a joined pair exists', () => {
      const verdict = classifyResidualPoints({
        windows: [window(30, 5)],
        baselineSd: 10,
        thresholds: THRESHOLDS,
        heldFallback: held,
        now: NOW,
      });
      expect(verdict).toMatchObject({ status: 'OK', basis: 'pairs' });
    });

    it('stays UNKNOWN without a reference SD, and OK inside the band', () => {
      expect(
        classifyResidualPoints({
          windows: [],
          baselineSd: null,
          thresholds: THRESHOLDS,
          heldFallback: held,
          now: NOW,
        }).status,
      ).toBe('UNKNOWN');
      expect(
        classifyResidualPoints({
          windows: [],
          baselineSd: 100,
          thresholds: THRESHOLDS,
          heldFallback: held,
          now: NOW,
        }).status,
      ).toBe('OK');
    });
  });
});
