import { describe, it, expect } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { DriftPanel } from '../drift-panel'
import { PsiPanel } from '../psi/psi-panel'
import type {
  DriftColumn,
  DriftReport,
  PsiColumn,
  PsiReport,
} from '@/services/model-monitoring'

/**
 * MODEL-SERVE-018. The target tag (y) renders as a pinned first row with a
 * neutral "Target (y)" badge, and never changes the card's header verdict:
 * it arrives in `report.target`, not `report.columns`.
 */

function driftCol(column: string, status: DriftColumn['status']): DriftColumn {
  return {
    column,
    n: 10,
    liveMean: 1,
    liveStd: 1,
    trainMean: 1,
    trainStd: 1,
    z: status === 'CRITICAL' ? 9 : 0.1,
    status,
  }
}

function driftReport(target: DriftColumn | null): DriftReport {
  return {
    status: 'OK',
    columns: [driftCol('TI-101', 'OK'), driftCol('FI-202', 'OK')],
    targetColumn: target?.column ?? null,
    target,
    basis: {
      plane: 'window',
      modelVersionId: 'v1',
      version: 1,
      goldArtifactId: 'a1',
      goldObjectKey: 'k1',
      sampleRequests: 3,
      from: '2026-01-01T00:00:00.000Z',
      to: '2026-01-01T01:00:00.000Z',
      thresholds: { warnSd: 1.5, criticalSd: 3 },
    },
  }
}

function psiCol(column: string, status: PsiColumn['status']): PsiColumn {
  return {
    column,
    liveTotal: 100,
    psi: status === 'CRITICAL' ? 0.9 : 0.01,
    outOfRangePct: 0,
    status,
    bins: null,
  }
}

function psiReport(target: PsiColumn | null): PsiReport {
  return {
    status: 'OK',
    columns: [psiCol('TI-101', 'OK')],
    targetColumn: target?.column ?? null,
    target,
    basis: {
      plane: 'window',
      modelVersionId: 'v1',
      version: 1,
      goldArtifactId: 'a1',
      goldObjectKey: 'k1',
      sampleRequests: 3,
      histogramRequests: 3,
      from: '2026-01-01T00:00:00.000Z',
      to: '2026-01-01T01:00:00.000Z',
      thresholds: { warn: 0.1, critical: 0.25, minSamplesPerBin: 20 },
      epsilon: 0.0001,
    },
  }
}

function bodyRows(): HTMLElement[] {
  // First rowgroup is <thead>, second is <tbody>.
  const tbody = screen.getAllByRole('rowgroup')[1]
  if (!tbody) throw new Error('no <tbody>')
  return within(tbody).getAllByRole('row')
}

function rowAt(i: number): HTMLElement {
  const row = bodyRows()[i]
  if (!row) throw new Error(`no body row ${i}`)
  return row
}

describe('DriftPanel target row (MODEL-SERVE-018)', () => {
  it('pins the target first with a Target (y) badge', () => {
    render(
      <DriftPanel
        report={driftReport(driftCol('Y-LAB', 'CRITICAL'))}
        loading={false}
        unavailableReason={null}
      />,
    )

    const rows = bodyRows()
    expect(rows).toHaveLength(3)
    expect(within(rowAt(0)).getByText('Y-LAB')).toBeVisible()
    expect(within(rowAt(0)).getByText('Target (y)')).toBeVisible()
    expect(within(rowAt(1)).queryByText('Target (y)')).not.toBeInTheDocument()
  })

  it('a CRITICAL target leaves the header verdict features-only', () => {
    render(
      <DriftPanel
        report={driftReport(driftCol('Y-LAB', 'CRITICAL'))}
        loading={false}
        unavailableReason={null}
      />,
    )

    // Only the target row's own pill says CRITICAL; the header still
    // reflects `report.status` ('OK').
    expect(screen.getAllByText('CRITICAL')).toHaveLength(1)
    expect(within(rowAt(0)).getByText('CRITICAL')).toBeVisible()
  })

  it('renders no target row when the report has none', () => {
    render(
      <DriftPanel
        report={driftReport(null)}
        loading={false}
        unavailableReason={null}
      />,
    )

    expect(bodyRows()).toHaveLength(2)
    expect(screen.queryByText('Target (y)')).not.toBeInTheDocument()
  })
})

describe('PsiPanel target row (MODEL-SERVE-018)', () => {
  it('pins the target first with a Target (y) badge', () => {
    render(
      <PsiPanel
        report={psiReport(psiCol('Y-LAB', 'CRITICAL'))}
        loading={false}
        unavailableReason={null}
      />,
    )

    const rows = bodyRows()
    expect(rows).toHaveLength(2)
    expect(within(rowAt(0)).getByText('Y-LAB')).toBeVisible()
    expect(within(rowAt(0)).getByText('Target (y)')).toBeVisible()
    expect(screen.getAllByText('CRITICAL')).toHaveLength(1)
  })

  it('renders no target row for an older backend that omits the field', () => {
    const legacy: PsiReport = psiReport(null)
    delete legacy.target
    delete legacy.targetColumn
    render(
      <PsiPanel report={legacy} loading={false} unavailableReason={null} />,
    )

    expect(bodyRows()).toHaveLength(1)
    expect(screen.queryByText('Target (y)')).not.toBeInTheDocument()
  })
})

describe('unrecorded target placeholder (MODEL-SERVE-018)', () => {
  it('drift: a known target with no verdict renders a muted not-recorded row', () => {
    render(
      <DriftPanel
        report={{ ...driftReport(null), targetColumn: 'Y-LAB' }}
        loading={false}
        unavailableReason={null}
      />,
    )

    expect(bodyRows()).toHaveLength(3)
    expect(within(rowAt(0)).getByText('Y-LAB')).toBeVisible()
    expect(within(rowAt(0)).getByText('Target (y)')).toBeVisible()
    expect(
      within(rowAt(0)).getByText(/Not recorded in this range/),
    ).toBeVisible()
  })

  it('psi: same placeholder, and the header verdict is untouched', () => {
    render(
      <PsiPanel
        report={{ ...psiReport(null), targetColumn: 'Y-LAB' }}
        loading={false}
        unavailableReason={null}
      />,
    )

    expect(bodyRows()).toHaveLength(2)
    expect(
      within(rowAt(0)).getByText(/Not recorded in this range/),
    ).toBeVisible()
    expect(screen.queryByText('CRITICAL')).not.toBeInTheDocument()
  })
})
