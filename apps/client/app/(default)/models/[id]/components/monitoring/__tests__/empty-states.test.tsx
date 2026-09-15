import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { LivePredictionChart } from '../live-prediction-chart'
import { DriftPanel } from '../drift-panel'
import { EmptyTruth } from '../model-monitoring-tab'
import type { LiveErrorCoverage } from '@/services/inference-window'

/**
 * MODEL-SERVE-001-T10, Part A. These two sections read `PredictionLog`,
 * which ONLY `apps/serving`'s synchronous `/predict` path writes. A
 * scheduled window writes `predictions.parquet` + an `InferenceWindow` row
 * instead — two planes by decision, not by oversight — so a model that has
 * only ever been scheduled is empty here BY CONSTRUCTION.
 *
 * The defect was never the absence. It was that both said only "no data",
 * which sent a reader hunting for a fault that does not exist. Each
 * assertion below is on the DISTINGUISHING sentence, never on "some empty
 * state rendered".
 */

describe('LivePredictionChart empty state (MODEL-SERVE-001-T10)', () => {
  it('names the stream it reads rather than saying only "no predictions"', () => {
    render(<LivePredictionChart points={[]} />)

    expect(screen.getByText(/synchronous \/predict traffic/i)).toBeVisible()
  })

  it('says scheduled inference does not write here', () => {
    render(<LivePredictionChart points={[]} />)

    expect(
      screen.getByText(/scheduled inference does not write here/i),
    ).toBeVisible()
  })

  it('points the reader at the sections that DO have data for such a model', () => {
    render(<LivePredictionChart points={[]} />)

    expect(screen.getByText(/actual vs\. predict and residual/i)).toBeVisible()
  })

  it('no longer renders the old undifferentiated sentence', () => {
    render(<LivePredictionChart points={[]} />)

    expect(
      screen.queryByText('No sampled predictions in this range yet.'),
    ).toBeNull()
  })
})

describe('DriftPanel empty states (MODEL-SERVE-001-T10)', () => {
  it('names the stream when there is no traffic to compare', () => {
    render(
      <DriftPanel report={null} loading={false} unavailableReason={null} />,
    )

    expect(screen.getByText(/synchronous \/predict traffic/i)).toBeVisible()
    expect(
      screen.getByText(/scheduled inference does not write them/i),
    ).toBeVisible()
  })

  it('leaves the unavailableReason rung alone — it is the precedent, not the defect', () => {
    render(
      <DriftPanel
        report={null}
        loading={false}
        unavailableReason="This model has no PRODUCTION version."
      />,
    )

    expect(
      screen.getByText('This model has no PRODUCTION version.'),
    ).toBeVisible()
    // The traffic sentence must NOT also appear: a model with no production
    // version has a different problem, and stacking both would restate the
    // confusion this task removes.
    expect(screen.queryByText(/synchronous \/predict traffic/i)).toBeNull()
  })

  it('still shows its loading rung', () => {
    render(<DriftPanel report={null} loading={true} unavailableReason={null} />)

    expect(screen.getByText(/loading drift report/i)).toBeVisible()
  })

  // MODEL-SERVE-001-T16: `DriftPanel` no longer accepts PSI props at all —
  // that metric moved to its own `PsiPanel` (see `psi-panel.test.tsx`). This
  // is the negative-space check for the rejected shape: no PSI column, no
  // PSI status column, on ANY render of this table.
  it('never renders a PSI column — that metric moved to its own card (T13/T16)', () => {
    render(
      <DriftPanel
        report={{
          status: 'OK',
          columns: [
            {
              column: 'TI-101',
              n: 10,
              liveMean: 1,
              liveStd: 1,
              trainMean: 1,
              trainStd: 1,
              z: 0,
              outOfRangePct: 0,
              status: 'OK',
            },
          ],
          basis: {
            modelVersionId: 'v1',
            version: 1,
            goldArtifactId: 'a1',
            goldObjectKey: 'k1',
            sampleRequests: 10,
            from: '2026-01-01T00:00:00.000Z',
            to: '2026-01-01T01:00:00.000Z',
          },
        }}
        loading={false}
        unavailableReason={null}
      />,
    )

    expect(
      screen.queryByRole('columnheader', { name: 'PSI' }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('columnheader', { name: 'PSI status' }),
    ).not.toBeInTheDocument()
  })
})

function coverage(over: Partial<LiveErrorCoverage> = {}): LiveErrorCoverage {
  return {
    windowsInRange: 0,
    windowsSkipped: 0,
    windowsJoined: 0,
    windowsAwaitingTruth: 0,
    truthRows: 0,
    pairedRows: 0,
    windowsFailed: 0,
    maxMissingPct: null,
    ...over,
  }
}

/**
 * MODEL-SERVE-001-T11. A FOURTH empty cause `EmptyTruth` could not
 * previously name: `windowsInRange` counts SUCCEEDED only, so a range where
 * every window was SKIPPED (too few usable rows, T01's real terminal
 * status — never a failure) read identically to "the scheduler never ran
 * here". It ran, fetched, and declined; a SKIPPED window also writes no
 * predictions.parquet, so this branch is the only place in range that can
 * say which zero-state this is.
 */
describe('EmptyTruth — the fourth cause (MODEL-SERVE-001-T11)', () => {
  it('names an all-SKIPPED range distinctly from "never ran here"', () => {
    render(
      <EmptyTruth
        error={null}
        coverage={coverage({ windowsInRange: 0, windowsSkipped: 3 })}
      />,
    )

    expect(screen.getByText(/3 windows were skipped/i)).toBeVisible()
    expect(screen.getByText(/ran and declined/i)).toBeVisible()
    // The old undifferentiated sentence must not ALSO render for this case.
    expect(
      screen.queryByText('No completed inference windows in this range yet.'),
    ).toBeNull()
  })

  it('singular wording for exactly one skipped window', () => {
    render(
      <EmptyTruth
        error={null}
        coverage={coverage({ windowsInRange: 0, windowsSkipped: 1 })}
      />,
    )

    expect(screen.getByText(/1 window was skipped/i)).toBeVisible()
  })

  it('checked BEFORE the bare zero-windows branch: 0 in range, 0 skipped, still reads "never ran here"', () => {
    render(
      <EmptyTruth
        error={null}
        coverage={coverage({ windowsInRange: 0, windowsSkipped: 0 })}
      />,
    )

    expect(
      screen.getByText('No completed inference windows in this range yet.'),
    ).toBeVisible()
  })

  it('a SUCCEEDED range with skipped siblings still reaches the normal truth branches, not the skip sentence', () => {
    render(
      <EmptyTruth
        error={null}
        coverage={coverage({
          windowsInRange: 2,
          windowsSkipped: 5,
          truthRows: 0,
        })}
      />,
    )

    // windowsInRange > 0, so the SKIPPED branch (gated on windowsInRange
    // === 0) must not fire even though windowsSkipped is non-zero.
    expect(screen.queryByText(/windows were skipped/i)).toBeNull()
    expect(screen.getByText(/no lab measurement has arrived/i)).toBeVisible()
  })
})
