import { describe, it, expect } from 'vitest'
import {
  CRITERIA_VERDICT_SEPARATOR,
  explainPsiColumn,
  explainPsiReport,
} from '@/lib/monitoring-status-explain'
import type { PsiReport } from '@/services/model-monitoring'

const PSI_THRESHOLDS = { warn: 0.1, critical: 0.25, minSamplesPerBin: 20, outOfRangeWarnPct: 5, outOfRangeCriticalPct: 20 }

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

describe('explainPsiColumn', () => {
  // MODEL-SERVE-029. Out-of-range is graded beside PSI; each rule gets its
  // own line so the tooltip names whichever one decided the status.
  it('quotes the out-of-range share as its own criterion beside PSI', () => {
    const { criteria } = explainPsiColumn(
      {
        psi: 0.02,
        status: 'WARN',
        liveTotal: 300,
        bins: null,
        outOfRangePct: 6,
      },
      PSI_THRESHOLDS,
    )

    expect(criteria).toEqual([
      'PSI 0.020 < 0.1 → Good',
      'Out of range 6.0% ≥ 5% → WARN (critical at 20%)',
    ])
  })

  it('all samples out of range: no PSI line, the out-of-range line is the criterion', () => {
    const { criteria } = explainPsiColumn(
      {
        psi: null,
        status: 'CRITICAL',
        liveTotal: 300,
        bins: null,
        outOfRangePct: 100,
      },
      PSI_THRESHOLDS,
    )

    expect(criteria).toEqual(['Out of range 100.0% ≥ 20% → CRITICAL'])
  })

  // `status-badge-with-explanation.tsx` splits each line on this to bold
  // the verdict half. That makes the separator a CONTRACT between the two
  // files, not a formatting detail — changing it here without the
  // component would silently stop the highlighting, with the tooltip
  // still rendering a correct-looking line.
  it('separates condition from verdict with the exported separator', () => {
    const { criteria } = explainPsiColumn(
      { psi: 0.3, status: 'CRITICAL', liveTotal: 300, bins: null },
      PSI_THRESHOLDS,
    )

    expect(CRITERIA_VERDICT_SEPARATOR).toBe(' → ')
    expect(criteria[0]?.split(CRITERIA_VERDICT_SEPARATOR)).toEqual([
      'PSI 0.300 ≥ 0.25',
      'CRITICAL',
    ])
  })

  it('prints no criteria at all before a report has loaded', () => {
    // The Input Data table can render before the PSI fetch settles.
    // Inventing 0.1/0.25 here would render a confident number nothing
    // produced.
    const { meaning, criteria } = explainPsiColumn(
      { psi: 0.15, status: 'WARN', liveTotal: 300, bins: null },
      undefined,
    )

    expect(criteria).toEqual([])
    expect(meaning).not.toBe('')
  })

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
        thresholds: { warn: 0.2, critical: 0.5, minSamplesPerBin: 20, outOfRangeWarnPct: 5, outOfRangeCriticalPct: 20 },
      },
    })

    const { criteria } = explainPsiReport(report)

    expect(criteria[1]).toBe('warn ≥ 0.2, critical ≥ 0.5')
  })
})
