import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { PsiPanel } from '../psi/psi-panel'
import type {
  ColumnBins,
  PsiColumn,
  PsiReport,
} from '@/services/model-monitoring'

/**
 * MODEL-SERVE-001-T13/T16. `PsiPanel` is a card fully independent of
 * `DriftPanel` — it takes no drift-related props at all (see
 * `empty-states.test.tsx`'s own negative-space check that `DriftPanel` no
 * longer accepts PSI props). That independence is the structural fix this
 * rebuild makes: the previous merged component gated a perfectly good PSI
 * report behind the Z-SCORE's own loading/empty/unavailable rungs, so this
 * file never needs to render `DriftPanel` at all to prove PSI's own states.
 */

function makeBins(overrides: Partial<ColumnBins> = {}): ColumnBins {
  return {
    binMode: 'continuous',
    binCount: 10,
    edges: [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100],
    refCounts: [10, 10, 10, 10, 10, 10, 10, 10, 10, 10],
    liveCounts: [22, 18, 5, 2, 1, 1, 3, 8, 20, 20],
    below: 0,
    above: 0,
    liveInRangeTotal: 100,
    minSamples: 200,
    ...overrides,
  }
}

function makeColumn(overrides: Partial<PsiColumn> = {}): PsiColumn {
  return {
    column: 'TI-101',
    liveTotal: 100,
    psi: 0.9469,
    outOfRangePct: 0,
    status: 'CRITICAL',
    bins: makeBins(),
    ...overrides,
  }
}

function makeReport(
  columns: PsiColumn[],
  basisOverrides: Partial<PsiReport['basis']> = {},
): PsiReport {
  return {
    status: columns.some(c => c.status === 'CRITICAL') ? 'CRITICAL' : 'OK',
    columns,
    basis: {
      modelVersionId: 'v1',
      version: 1,
      goldArtifactId: 'a1',
      goldObjectKey: 'k1',
      sampleRequests: 100,
      histogramRequests: 100,
      from: '2026-01-01T00:00:00.000Z',
      to: '2026-01-01T01:00:00.000Z',
      thresholds: { warn: 0.1, critical: 0.25, minSamplesPerBin: 20 },
      epsilon: 0.0001,
      ...basisOverrides,
    },
  }
}

describe('PsiPanel', () => {
  it('renders its own summary table with the columns T13 chose', () => {
    render(
      <PsiPanel
        report={makeReport([makeColumn()])}
        loading={false}
        unavailableReason={null}
      />,
    )

    expect(screen.getByRole('columnheader', { name: 'Tag' })).toBeVisible()
    expect(screen.getByRole('columnheader', { name: 'PSI' })).toBeVisible()
    expect(screen.getByRole('columnheader', { name: 'Status' })).toBeVisible()
    expect(
      screen.getByRole('columnheader', { name: 'Bins used' }),
    ).toBeVisible()
    expect(
      screen.getByRole('columnheader', { name: 'Computed over' }),
    ).toBeVisible()
  })

  it('renders its own loading rung, independent of any drift state', () => {
    render(<PsiPanel report={null} loading={true} unavailableReason={null} />)
    expect(screen.getByText(/loading psi report/i)).toBeVisible()
  })

  it('renders its own unavailable rung, independent of any drift state', () => {
    render(
      <PsiPanel
        report={null}
        loading={false}
        unavailableReason="This model has no PRODUCTION version."
      />,
    )
    expect(
      screen.getByText('This model has no PRODUCTION version.'),
    ).toBeVisible()
  })

  it('renders its own empty rung, naming why, when drift would have data but PSI has none', () => {
    render(
      <PsiPanel
        report={makeReport([])}
        loading={false}
        unavailableReason={null}
      />,
    )
    expect(screen.getByText(/no psi-eligible \/predict traffic/i)).toBeVisible()
  })

  it('renders INSUFFICIENT_DATA as a first-class state: rows-vs-floor, no numeric PSI, row inert', () => {
    const col = makeColumn({
      status: 'INSUFFICIENT_DATA',
      psi: null,
      liveTotal: 42,
      bins: makeBins({ liveInRangeTotal: 42, minSamples: 200 }),
    })
    render(
      <PsiPanel
        report={makeReport([col])}
        loading={false}
        unavailableReason={null}
      />,
    )

    const row = screen.getByText('TI-101').closest('tr')
    expect(row).not.toBeNull()
    const scoped = within(row as HTMLElement)

    expect(scoped.getByText(/insufficient data/i)).toBeVisible()
    expect(scoped.getByText(/42 of 200 rows/i)).toBeVisible()
    // No numeric PSI — an em-dash, never a value computed from too few
    // samples.
    expect(scoped.getByText('—')).toBeVisible()

    // Row is INERT: no chevron, and clicking it opens nothing.
    fireEvent.click(row as HTMLElement)
    expect(screen.queryByRole('columnheader', { name: 'Bin' })).toBeNull()
  })

  it('shows a REDUCED bin count for a degenerate tag, never a default of 10', () => {
    const col = makeColumn({
      status: 'OK',
      psi: 0.01,
      bins: makeBins({
        binCount: 3,
        edges: [0, 1, 2, 3],
        refCounts: [34, 33, 33],
        liveCounts: [11, 11, 12],
        liveInRangeTotal: 34,
        minSamples: 60,
      }),
    })
    render(
      <PsiPanel
        report={makeReport([col])}
        loading={false}
        unavailableReason={null}
      />,
    )

    expect(screen.getByText('3 (quantile)')).toBeVisible()
  })

  it('click opens the chart and the edge table with REAL engineering-unit ranges, not bare B1..B10', () => {
    render(
      <PsiPanel
        report={makeReport([makeColumn()])}
        loading={false}
        unavailableReason={null}
      />,
    )

    fireEvent.click(screen.getByText('TI-101'))

    // The edge table appears (its own column headers, distinct from the
    // summary table above).
    expect(screen.getByRole('columnheader', { name: 'Bin' })).toBeVisible()
    expect(screen.getByRole('columnheader', { name: 'Range' })).toBeVisible()
    // The bare chart-axis label "B1" exists, but the RANGE COLUMN must
    // carry the real engineering-unit bracket — not the bare label itself.
    expect(screen.getByText('[0, 10)')).toBeVisible()
    // The last bin is closed on the right, per psi.py's own convention.
    expect(screen.getByText('[90, 100]')).toBeVisible()
  })

  it('second click closes the drill-down', () => {
    render(
      <PsiPanel
        report={makeReport([makeColumn()])}
        loading={false}
        unavailableReason={null}
      />,
    )

    const tagCell = screen.getByText('TI-101')
    fireEvent.click(tagCell)
    expect(screen.getByRole('columnheader', { name: 'Bin' })).toBeVisible()

    fireEvent.click(tagCell)
    expect(screen.queryByRole('columnheader', { name: 'Bin' })).toBeNull()
  })

  it('categorical tag: no <lo/>hi overflow bars, a MEASURED (non-flat) reference, and the last bin label matches edges.length === binCount', () => {
    const col = makeColumn({
      status: 'WARN',
      psi: 0.12,
      bins: makeBins({
        binMode: 'categorical',
        binCount: 2,
        edges: [0, 1],
        refCounts: [90, 10],
        liveCounts: [70, 30],
        below: 0,
        above: 0,
        liveInRangeTotal: 100,
      }),
    })
    render(
      <PsiPanel
        report={makeReport([col])}
        loading={false}
        unavailableReason={null}
      />,
    )

    fireEvent.click(screen.getByText('TI-101'))

    // No overflow rows for a categorical tag — that bucketing has no
    // "out of range" concept (psi.py).
    expect(screen.queryByText('<lo')).toBeNull()
    expect(screen.queryByText('>hi')).toBeNull()

    // Reference is a REAL measured 90/10 split, never an assumed flat 50/50
    // — `psi.py`'s own module docstring: a categorical split is not
    // equal-frequency the way a quantile split is.
    expect(screen.getByText('90.0%')).toBeVisible()
    expect(screen.getByText('10.0%')).toBeVisible()
    expect(screen.queryByText('50.0%')).toBeNull()

    // Last bin (edges.length === binCount here, never binCount + 1): the
    // second and final trained value, "1" — an off-by-one that assumed
    // continuous semantics would read past the array or mislabel this.
    expect(screen.getByText('B2')).toBeVisible()
    expect(screen.getByText('1')).toBeVisible()
  })

  it('footnote numbers come from basis.thresholds/epsilon, not a hardcoded literal', () => {
    render(
      <PsiPanel
        report={makeReport([makeColumn()], {
          thresholds: { warn: 0.15, critical: 0.4, minSamplesPerBin: 30 },
          epsilon: 0.0002,
        })}
        loading={false}
        unavailableReason={null}
      />,
    )

    expect(screen.getByText(/0\.15 warn/)).toBeVisible()
    expect(screen.getByText(/0\.4 critical/)).toBeVisible()
    expect(screen.getByText(/0\.0002/)).toBeVisible()
    // The old hardcoded literal must NOT also appear.
    expect(screen.queryByText(/0\.1 warn \/ 0\.25 critical/)).toBeNull()
  })

  /**
   * MODEL-SERVE-001-T13's own worked example, kept because it is the case
   * the whole feature was confirmed against: 10 frozen quantile bins,
   * reference flat at 10% each, current 22/18/5/2/1/1/3/8/20/20 — a
   * bimodal pile-up at both ends with the middle emptied. The ACTUAL psi.py
   * math for this shape is verified against real `computePsi` in
   * `prediction-psi.spec.ts` (backend); this test proves the CARD renders
   * that verdict correctly once computed — CRITICAL, not folded into an
   * "OK"-looking table row.
   */
  it('worked example: the 22/18/5/2/1/1/3/8/20/20 pile-up renders CRITICAL', () => {
    render(
      <PsiPanel
        report={makeReport([makeColumn()])}
        loading={false}
        unavailableReason={null}
      />,
    )

    const row = screen.getByText('TI-101').closest('tr')
    expect(within(row as HTMLElement).getByText('0.947')).toBeVisible()
    // Raw enum text — only INSUFFICIENT_DATA gets humanized prose (see the
    // dedicated test above); OK/WARN/CRITICAL/UNKNOWN match the existing
    // z-score table's own convention of printing the status as-is.
    expect(within(row as HTMLElement).getByText('CRITICAL')).toBeVisible()
  })
})
