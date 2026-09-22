import { describe, it, expect } from 'vitest'
import {
  CRITERIA_VERDICT_SEPARATOR,
  explainDriftColumn,
  explainDriftReport,
  explainPsiColumn,
  explainPsiReport,
} from '@/lib/monitoring-status-explain'
import type { DriftReport, PsiReport } from '@/services/model-monitoring'

const DRIFT_THRESHOLDS = { warnSd: 1.5, criticalSd: 3.0, outOfRangePct: 10 }
const PSI_THRESHOLDS = { warn: 0.1, critical: 0.25, minSamplesPerBin: 20 }

function driftReport(overrides: Partial<DriftReport> = {}): DriftReport {
  return {
    status: 'OK',
    columns: [],
    basis: {
      plane: 'predict',
      modelVersionId: 'v1',
      version: 1,
      goldArtifactId: 'a1',
      goldObjectKey: 'k1',
      sampleRequests: 10,
      from: '2026-01-01T00:00:00.000Z',
      to: '2026-01-01T01:00:00.000Z',
      thresholds: DRIFT_THRESHOLDS,
    },
    ...overrides,
  }
}

function psiReport(overrides: Partial<PsiReport> = {}): PsiReport {
  return {
    status: 'OK',
    columns: [],
    basis: {
      plane: 'predict',
      modelVersionId: 'v1',
      version: 1,
      goldArtifactId: 'a1',
      goldObjectKey: 'k1',
      sampleRequests: 100,
      histogramRequests: 100,
      from: '2026-01-01T00:00:00.000Z',
      to: '2026-01-01T01:00:00.000Z',
      thresholds: PSI_THRESHOLDS,
      epsilon: 0.0001,
    },
    ...overrides,
  }
}

describe('explainDriftColumn', () => {
  // `status-badge-with-explanation.tsx` splits each line on this to bold
  // the verdict half. That makes the separator a CONTRACT between the two
  // files, not a formatting detail — changing it here without the
  // component would silently stop the highlighting, with the tooltip
  // still rendering a correct-looking line.
  it('separates condition from verdict with the exported separator', () => {
    const { criteria } = explainDriftColumn(
      { z: 2.14, outOfRangePct: null, status: 'WARN' },
      DRIFT_THRESHOLDS,
    )

    expect(CRITERIA_VERDICT_SEPARATOR).toBe(' → ')
    expect(criteria[0]?.split(CRITERIA_VERDICT_SEPARATOR)).toEqual([
      '|z| 2.14 ≥ 1.5',
      'WARN',
    ])
  })

  it('names the z rule when z is what breached', () => {
    const { criteria } = explainDriftColumn(
      { z: 2.14, outOfRangePct: 1, status: 'WARN' },
      DRIFT_THRESHOLDS,
    )

    expect(criteria[0]).toBe('|z| 2.14 ≥ 1.5 → WARN')
  })

  it('names the CRITICAL line, not the warn line, past 3 SD', () => {
    const { criteria } = explainDriftColumn(
      { z: -3.42, outOfRangePct: 0, status: 'CRITICAL' },
      DRIFT_THRESHOLDS,
    )

    // |z|, so the sign is dropped — the backend's `statusFor` tests
    // `Math.abs(z)`, and a tooltip printing "-3.42 ≥ 3" would be nonsense.
    expect(criteria[0]).toBe('|z| 3.42 ≥ 3 → CRITICAL')
  })

  // THE TRAP THIS MODULE EXISTS FOR. `statusFor` is
  // `absZ >= warnSd || outOfRangePct >= threshold`, so a column can be
  // WARN with a perfectly calm z. A tooltip blaming z here would state
  // something the backend never concluded.
  it('blames out-of-range, not z, when only out-of-range breached', () => {
    const { criteria } = explainDriftColumn(
      { z: 0.3, outOfRangePct: 12, status: 'WARN' },
      DRIFT_THRESHOLDS,
    )

    // A passing comparison ends in the OK label ("Good"), so the tooltip
    // can badge it green — it used to read "(warn line)", which named a
    // threshold instead of stating the result.
    expect(criteria[0]).toBe('|z| 0.30 < 1.5 → Good')
    expect(criteria[1]).toBe('out-of-range 12.0% ≥ 10.0% → WARN')
    // Exactly two lines. The "(this rule never reaches CRITICAL)" suffix
    // and the estimated-vs-counted note were cut as too wordy for a
    // tooltip; this pins them out rather than letting either drift back.
    expect(criteria).toHaveLength(2)
  })

  it('prints no criteria at all when the backend sent no thresholds', () => {
    // A backend deployed before `basis.thresholds` shipped. Inventing
    // 1.5/3.0 here would render a confident number nothing produced.
    const { meaning, criteria } = explainDriftColumn(
      { z: 2.14, outOfRangePct: 12, status: 'WARN' },
      undefined,
    )

    expect(criteria).toEqual([])
    expect(meaning).not.toBe('')
  })

  it('explains UNKNOWN as an absence and folds in the backend reason', () => {
    const { meaning, criteria } = explainDriftColumn(
      {
        z: null,
        outOfRangePct: null,
        status: 'UNKNOWN',
        reason: 'no training baseline for this column',
      },
      DRIFT_THRESHOLDS,
    )

    expect(criteria).toEqual([])
    expect(meaning).toContain('no training baseline for this column')
    // Never phrased as health — UNKNOWN is missing information.
    expect(meaning).toContain('not a clean bill of health')
  })
})

describe('explainDriftReport', () => {
  it('describes the roll-up rather than one column’s arithmetic', () => {
    const report = driftReport({
      status: 'CRITICAL',
      columns: [
        {
          column: 'A',
          n: 1,
          liveMean: 0,
          liveStd: 1,
          trainMean: 0,
          trainStd: 1,
          z: 0.1,
          outOfRangePct: 0,
          status: 'OK',
        },
        {
          column: 'B',
          n: 1,
          liveMean: 0,
          liveStd: 1,
          trainMean: 0,
          trainStd: 1,
          z: 4,
          outOfRangePct: 0,
          status: 'CRITICAL',
        },
      ],
    })

    const { meaning, criteria } = explainDriftReport(report)

    expect(meaning).toContain('Worst verdict across 2 inputs')
    expect(criteria[0]).toBe('1 of 2 inputs at CRITICAL')
    // No |z| line: the header badge is not about any single column.
    expect(criteria.join(' ')).not.toContain('|z|')
  })
})

describe('explainPsiColumn', () => {
  it('quotes the PSI value against the warn line', () => {
    const { criteria } = explainPsiColumn(
      { psi: 0.15, status: 'WARN', liveTotal: 300, bins: null },
      PSI_THRESHOLDS,
    )

    expect(criteria[0]).toBe('PSI 0.150 ≥ 0.1 → WARN (critical at 0.25)')
  })

  it('explains INSUFFICIENT_DATA with rows-vs-floor, never a PSI value', () => {
    const { meaning, criteria } = explainPsiColumn(
      {
        psi: null,
        status: 'INSUFFICIENT_DATA',
        liveTotal: 42,
        bins: {
          binMode: 'continuous',
          binCount: 10,
          edges: [],
          refCounts: [],
          liveCounts: [],
          below: 0,
          above: 0,
          liveInRangeTotal: 42,
          minSamples: 200,
        },
      },
      PSI_THRESHOLDS,
    )

    expect(criteria[0]).toBe('42 of 200 rows required')
    expect(criteria[1]).toBe('floor = 10 bins × 20 rows per bin')
    expect(criteria.join(' ')).not.toContain('PSI 0')
    // Distinct from UNKNOWN: a reference DOES exist here.
    expect(meaning).toContain('Not enough live traffic yet')
  })

  it('gives UNKNOWN no criteria', () => {
    const { criteria } = explainPsiColumn(
      { psi: null, status: 'UNKNOWN', liveTotal: 0, bins: null },
      PSI_THRESHOLDS,
    )

    expect(criteria).toEqual([])
  })
})

describe('explainPsiReport', () => {
  it('quotes the report’s own thresholds, not a literal', () => {
    const base = psiReport()
    const report = psiReport({
      status: 'WARN',
      columns: [
        {
          column: 'A',
          liveTotal: 300,
          psi: 0.15,
          outOfRangePct: 0,
          status: 'WARN',
          bins: null,
        },
      ],
      basis: {
        ...base.basis,
        thresholds: { warn: 0.2, critical: 0.5, minSamplesPerBin: 20 },
      },
    })

    const { criteria } = explainPsiReport(report)

    expect(criteria[1]).toBe('warn ≥ 0.2, critical ≥ 0.5')
  })
})
