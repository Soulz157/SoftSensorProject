import { describe, it, expect } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { InputDriftPanel } from '../input-drift/input-drift-panel'
import type {
  ColumnRangeDrift,
  InputDriftReport,
} from '@/services/model-monitoring'

/**
 * MODEL-SERVE-018. The target tag (y) renders as a pinned first row with a
 * neutral "Target (y)" badge, and never changes the card's header verdict:
 * it arrives in `report.target`, not `report.columns`.
 */

function driftCol(
  column: string,
  status: ColumnRangeDrift['status'],
): ColumnRangeDrift {
  return {
    column,
    liveTotal: 100,
    below: 0,
    above: status === 'CRITICAL' ? 60 : 0,
    outOfRangePct: status === 'CRITICAL' ? 60 : 0,
    trainMin: 0,
    trainMax: 10,
    binMode: 'continuous',
    status,
    bins: null,
  }
}

function report(target: ColumnRangeDrift | null): InputDriftReport {
  return {
    status: 'OK',
    columns: [driftCol('TI-101', 'OK')],
    targetColumn: target?.column ?? null,
    target,
    series: {},
    basis: {
      plane: 'window',
      modelVersionId: 'v1',
      version: 1,
      from: '2026-01-01T00:00:00.000Z',
      to: '2026-01-01T01:00:00.000Z',
      windowsUsed: 1,
      capped: false,
      maxDays: 31,
      truncated: false,
      missing: 0,
      healthWindows: 24,
      thresholds: {
        outOfRangeWarnPct: 5,
        outOfRangeCriticalPct: 20,
        minSamples: 30,
      },
    },
  }
}

function rows(): HTMLElement[] {
  return screen.getAllByRole('listitem')
}

describe('InputDriftPanel target row (MODEL-SERVE-018)', () => {
  it('pins the target first with a Target (y) badge', () => {
    render(
      <InputDriftPanel
        report={report(driftCol('Y-LAB', 'CRITICAL'))}
        loading={false}
        unavailableReason={null}
      />,
    )

    expect(rows()).toHaveLength(2)
    expect(within(rows()[0]!).getByText('Y-LAB')).toBeVisible()
    expect(within(rows()[0]!).getByText('Target (y)')).toBeVisible()
    // The header verdict stays the features' own (OK) — only the target
    // row reads CRITICAL.
    expect(screen.getAllByText('CRITICAL')).toHaveLength(1)
  })

  it('renders no target row for an older backend that omits the field', () => {
    const legacy = report(null)
    delete legacy.target
    delete legacy.targetColumn
    render(
      <InputDriftPanel
        report={legacy}
        loading={false}
        unavailableReason={null}
      />,
    )

    expect(rows()).toHaveLength(1)
    expect(screen.queryByText('Target (y)')).not.toBeInTheDocument()
  })
})

describe('unrecorded target placeholder (MODEL-SERVE-018)', () => {
  it('a known target with no verdict renders a muted not-recorded row, and the header verdict is untouched', () => {
    render(
      <InputDriftPanel
        report={{ ...report(null), targetColumn: 'Y-LAB' }}
        loading={false}
        unavailableReason={null}
      />,
    )

    expect(rows()).toHaveLength(2)
    expect(within(rows()[0]!).getByText('Y-LAB')).toBeVisible()
    expect(within(rows()[0]!).getByText('Target (y)')).toBeVisible()
    expect(
      within(rows()[0]!).getByText(/Not recorded in this range/),
    ).toBeVisible()
    expect(screen.queryByText('CRITICAL')).not.toBeInTheDocument()
  })
})
