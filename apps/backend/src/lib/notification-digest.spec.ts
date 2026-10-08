import {
  buildDigestData,
  resolveStatusSince,
  buildDigestRows,
  outOfRangeBandFor,
  parseMetrics,
  psiBandFor,
  sdBandFor,
  shortReason,
  summarizePsi,
  type DigestStateInput,
  type DigestThresholds,
} from './notification-digest';
import type { PsiReport } from './prediction-psi';

const LEGEND: DigestThresholds = {
  warn: 0.1,
  critical: 0.25,
  outOfRangeWarnPct: 5,
  outOfRangeCriticalPct: 20,
};

describe('band grading (MODEL-SERVE-031)', () => {
  it('grades PSI with >= at the warn and critical cutoffs', () => {
    expect(psiBandFor(0.0999, LEGEND)).toBe('ok');
    expect(psiBandFor(0.1, LEGEND)).toBe('warn');
    expect(psiBandFor(0.2499, LEGEND)).toBe('warn');
    expect(psiBandFor(0.25, LEGEND)).toBe('crit');
    expect(psiBandFor(null, LEGEND)).toBeNull();
  });

  it('grades out-of-range % with >= at its own cutoffs', () => {
    expect(outOfRangeBandFor(4.9, LEGEND)).toBe('ok');
    expect(outOfRangeBandFor(5, LEGEND)).toBe('warn');
    expect(outOfRangeBandFor(20, LEGEND)).toBe('crit');
    expect(outOfRangeBandFor(null, LEGEND)).toBeNull();
  });

  it('grades the SD ratio against the per-model warn/crit bands', () => {
    expect(sdBandFor(1.4, 1.5, 3)).toBe('ok');
    expect(sdBandFor(1.5, 1.5, 3)).toBe('warn');
    expect(sdBandFor(3, 1.5, 3)).toBe('crit');
    expect(sdBandFor(null, 1.5, 3)).toBeNull();
    expect(sdBandFor(2, null, null)).toBeNull();
  });
});

describe('summarizePsi', () => {
  it('takes the worst PSI column and the largest out-of-range share', () => {
    const report = {
      status: 'WARN',
      columns: [
        { column: 'A', psi: 0.05, outOfRangePct: 9 },
        { column: 'B', psi: 0.2, outOfRangePct: 1 },
      ],
    } as unknown as PsiReport;
    expect(summarizePsi(report)).toEqual({
      worstColumn: 'B',
      worstPsi: 0.2,
      maxOutOfRangePct: 9,
    });
  });

  it('keeps nulls when no column has a computed value', () => {
    const report = {
      status: 'UNKNOWN',
      columns: [{ column: 'A', psi: null, outOfRangePct: null }],
    } as unknown as PsiReport;
    expect(summarizePsi(report)).toEqual({
      worstColumn: null,
      worstPsi: null,
      maxOutOfRangePct: null,
    });
  });
});

describe('parseMetrics', () => {
  it('returns null for a non-object and nulls for wrong-typed fields', () => {
    expect(parseMetrics(null)).toBeNull();
    expect(parseMetrics([1])).toBeNull();
    expect(parseMetrics({ worstPsi: 'x', sdRatio: 2 })).toMatchObject({
      worstPsi: null,
      sdRatio: 2,
    });
  });
});

function state(over: Partial<DigestStateInput>): DigestStateInput {
  return {
    modelId: 'm',
    modelName: 'M',
    status: 'OK',
    reason: null,
    frozenColumns: [],
    metrics: null,
    ...over,
  };
}

describe('buildDigestRows', () => {
  it('keeps only problem states, worst first then by name', () => {
    const rows = buildDigestRows(
      [
        state({ modelId: '1', modelName: 'Ok', status: 'OK' }),
        state({ modelId: '2', modelName: 'Warn', status: 'WARN' }),
        state({ modelId: '3', modelName: 'Alert', status: 'ALERT' }),
        state({ modelId: '4', modelName: 'Off', status: 'OFF' }),
      ],
      LEGEND,
    );
    expect(rows.map((r) => r.model)).toEqual(['Alert', 'Warn']);
  });

  it('shows frozen rows with no PSI / OoR and the frozen columns', () => {
    const [row] = buildDigestRows(
      [
        state({
          status: 'FROZEN',
          frozenColumns: ['FI-1', 'TI-2'],
          metrics: { worstPsi: 0.9, maxOutOfRangePct: 50 },
        }),
      ],
      LEGEND,
    );
    expect(row.psi).toBeNull();
    expect(row.outOfRangePct).toBeNull();
    expect(row.reason).toBe('Frozen: FI-1, TI-2');
  });

  it('grades each metric on its own and leaves a missing SD ratio null', () => {
    const [row] = buildDigestRows(
      [
        state({
          status: 'ALERT',
          reason: 'DRIFT_CRITICAL',
          metrics: {
            worstPsiColumn: 'FI-1001',
            worstPsi: 0.31,
            maxOutOfRangePct: 24,
            sdRatio: null,
            warnSd: 1.5,
            criticalSd: 3,
          },
        }),
      ],
      LEGEND,
    );
    expect(row).toMatchObject({
      reason: 'Drift',
      worstInput: 'FI-1001',
      psiBand: 'crit',
      outOfRangeBand: 'crit',
      sdRatio: null,
      sdBand: null,
    });
  });
});

describe('deploy-aware status word', () => {
  it('lists a stopped model as OFFLINE, matching the bell, not as ALERT', () => {
    const [row] = buildDigestRows(
      [
        state({
          status: 'ALERT',
          reason: 'SOURCE_UNREACHABLE',
          metrics: { statusWord: 'offline' },
        }),
      ],
      LEGEND,
    );
    expect(row.status).toBe('offline');
  });

  it('drops a model whose persisted word is normal even if raw health looks bad', () => {
    expect(
      buildDigestRows(
        [state({ status: 'WARN', metrics: { statusWord: 'normal' } })],
        LEGEND,
      ),
    ).toEqual([]);
  });

  it('falls back to raw health for a row written before the word was stored', () => {
    const [row] = buildDigestRows([state({ status: 'WARN' })], LEGEND);
    expect(row.status).toBe('warning');
  });
});

describe('buildDigestData', () => {
  it('counts each status and keeps the watched total', () => {
    const d = buildDigestData({
      workspaceName: 'ROC',
      total: 12,
      legend: LEGEND,
      changes: [],
      at: new Date('2026-10-07T09:00:00.000Z'),
      states: [
        state({ modelId: '1', status: 'ALERT' }),
        state({ modelId: '2', status: 'CRITICAL' }),
        state({ modelId: '3', status: 'WARN' }),
      ],
    });
    expect(d).toMatchObject({
      total: 12,
      alertCount: 2,
      warningCount: 1,
      frozenCount: 0,
    });
  });
});

describe('shortReason', () => {
  it('uses short labels that do not contradict the band column', () => {
    expect(shortReason('RESIDUAL_SD_WARN')).toBe('Residual SD');
    expect(shortReason('DRIFT_WARN')).toBe('Drift');
    expect(shortReason(null)).toBe('—');
  });
});

describe('status since / longest (MODEL-SERVE-031)', () => {
  const now = new Date('2026-10-07T09:00:00.000Z');
  const base = {
    prevStatus: 'ALERT',
    prevUpdatedAt: new Date('2026-10-01T00:00:00.000Z'),
    nextStatus: 'ALERT',
    nextWord: 'alert',
    now,
  };
  const prev = (statusWord: string, statusSince: string | null) => ({
    worstPsiColumn: null,
    worstPsi: null,
    maxOutOfRangePct: null,
    sdRatio: null,
    warnSd: null,
    criticalSd: null,
    statusWord,
    statusSince,
  });

  it('carries the since-time forward while the status word is unchanged', () => {
    expect(
      resolveStatusSince({
        ...base,
        prevMetrics: prev('alert', '2026-10-05T06:00:00.000Z'),
      }),
    ).toBe('2026-10-05T06:00:00.000Z');
  });

  it('resets to now when the status word changes', () => {
    expect(
      resolveStatusSince({
        ...base,
        prevMetrics: prev('warning', '2026-10-05T06:00:00.000Z'),
      }),
    ).toBe(now.toISOString());
  });

  it('uses updatedAt of a row written before metrics existed, when the status is unchanged', () => {
    expect(resolveStatusSince({ ...base, prevMetrics: null })).toBe(
      '2026-10-01T00:00:00.000Z',
    );
    expect(
      resolveStatusSince({ ...base, prevMetrics: null, prevStatus: 'WARN' }),
    ).toBe(now.toISOString());
  });

  it('starts at now for a brand-new row', () => {
    expect(
      resolveStatusSince({
        ...base,
        prevMetrics: null,
        prevStatus: null,
        prevUpdatedAt: null,
      }),
    ).toBe(now.toISOString());
  });

  it('computes open minutes per row and picks the longest problem', () => {
    const d = buildDigestData({
      workspaceName: 'ROC',
      total: 3,
      legend: LEGEND,
      changes: [],
      at: now,
      states: [
        state({
          modelId: '1',
          modelName: 'Recent',
          status: 'ALERT',
          metrics: {
            statusWord: 'alert',
            statusSince: '2026-10-07T08:00:00.000Z',
          },
        }),
        state({
          modelId: '2',
          modelName: 'Old',
          status: 'WARN',
          metrics: {
            statusWord: 'warning',
            statusSince: '2026-10-05T09:00:00.000Z',
          },
        }),
        state({ modelId: '3', modelName: 'Unknown', status: 'WARN' }),
      ],
    });
    expect(d.rows.find((r) => r.model === 'Recent')?.openMinutes).toBe(60);
    expect(d.rows.find((r) => r.model === 'Unknown')?.openMinutes).toBeNull();
    expect(d.longest).toEqual({
      model: 'Old',
      status: 'warning',
      since: '2026-10-05T09:00:00.000Z',
      minutes: 2880,
    });
  });

  it('has no longest when no row has a since-time', () => {
    const d = buildDigestData({
      workspaceName: 'ROC',
      total: 1,
      legend: LEGEND,
      changes: [],
      at: now,
      states: [state({ status: 'WARN' })],
    });
    expect(d.longest).toBeNull();
  });
});
