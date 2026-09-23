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

  /**
   * MODEL-SERVE-008-T06. T02's live driver made the by-construction claim
   * FALSE for any model whose driver is on: scheduled inference still never
   * writes this stream, but the driver does. A section naming a cause that
   * no longer applies is worse than one saying nothing, because a reader
   * trusts it.
   */
  it('does NOT claim the stream is empty by construction when the driver is on', () => {
    render(<LivePredictionChart points={[]} livePredictEnabled />)

    expect(
      screen.queryByText(/scheduled inference does not write here/i),
    ).toBeNull()
    expect(
      screen.getByText(/live prediction is on for this model/i),
    ).toBeVisible()
  })

  it('says why an enabled driver can still show nothing, without blaming the model', () => {
    render(<LivePredictionChart points={[]} livePredictEnabled />)

    expect(
      screen.getByText(/scoring pauses whenever the historian is unreachable/i),
    ).toBeVisible()
  })

  it('keeps the by-construction sentence when the driver is OFF — the default is unchanged', () => {
    // No prop at all: a caller that never opted into the new state must not
    // silently get a different message.
    render(<LivePredictionChart points={[]} />)

    expect(
      screen.getByText(/scheduled inference does not write here/i),
    ).toBeVisible()
    expect(screen.queryByText(/live prediction is on/i)).toBeNull()
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
              status: 'OK',
            },
          ],
          basis: {
            plane: 'predict',
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

  // MODEL-SERVE-001-T17: the backend has always sent `col.n`; this table
  // never rendered it until this task. A z-score pooled from one window
  // must not look as solid on screen as one from 1,440.
  it('renders the Samples column with the real pooled count', () => {
    render(
      <DriftPanel
        report={{
          status: 'OK',
          columns: [
            {
              column: 'TI-101',
              n: 42,
              liveMean: 1,
              liveStd: 1,
              trainMean: 1,
              trainStd: 1,
              z: 0,
              status: 'OK',
            },
          ],
          basis: {
            plane: 'window',
            modelVersionId: 'v1',
            version: 1,
            goldArtifactId: 'a1',
            goldObjectKey: 'k1',
            sampleRequests: 3,
            from: '2026-01-01T00:00:00.000Z',
            to: '2026-01-01T01:00:00.000Z',
          },
        }}
        loading={false}
        unavailableReason={null}
      />,
    )

    expect(screen.getByRole('columnheader', { name: 'Samples' })).toBeVisible()
    expect(screen.getByText('42')).toBeVisible()
    // Window-plane copy: "window(s)", never "sampled request(s)".
    expect(screen.getByText(/3 windows vs\. version/i)).toBeVisible()
  })

  // This CARD reads Good / WARN / CRITICAL; the Input Data feature table's
  // inline badge deliberately still reads the raw `OK` token, because there
  // it sits beside a PI health badge that already owns the word "Good"
  // (see input-feature-table.test.tsx's "two different questions" case and
  // lib/drift-status-style.ts). Pinning the card side here keeps that split
  // from collapsing back into one vocabulary unnoticed.
  it('renders the wire status OK as "Good" on the card', () => {
    render(
      <DriftPanel
        report={{
          status: 'OK',
          columns: [
            {
              column: 'TI-101',
              n: 42,
              liveMean: 1,
              liveStd: 1,
              trainMean: 1,
              trainStd: 1,
              z: 0,
              status: 'OK',
            },
          ],
          basis: {
            plane: 'window',
            modelVersionId: 'v1',
            version: 1,
            goldArtifactId: 'a1',
            goldObjectKey: 'k1',
            sampleRequests: 3,
            from: '2026-01-01T00:00:00.000Z',
            to: '2026-01-01T01:00:00.000Z',
          },
        }}
        loading={false}
        unavailableReason={null}
      />,
    )

    // Header badge and the one column row.
    expect(screen.getAllByText('Good')).toHaveLength(2)
    expect(screen.queryByText('OK')).toBeNull()
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
    truthLagMinutes: null,
    earliestEligibleAt: null,
    windowsLapsedTruth: 0,
    predictionRows: 0,
    cadenceMinutes: null,
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

/**
 * MODEL-SERVE-001-T18. "The join runs again once the configured truth lag
 * has passed" reads identically at minute 1 and hour 23 of the wait. When
 * the backend can name a concrete `earliestEligibleAt`, the reader should
 * see it rather than an indefinite wait.
 */
describe('EmptyTruth — naming the wait (MODEL-SERVE-001-T18)', () => {
  it('names the concrete eligible time when the backend can compute one', () => {
    render(
      <EmptyTruth
        error={null}
        coverage={coverage({
          windowsInRange: 3,
          truthRows: 0,
          truthLagMinutes: 1440,
          earliestEligibleAt: '2026-09-15T08:00:00.000Z',
        })}
      />,
    )

    expect(screen.getByText(/up to 24h to report/i)).toBeVisible()
    expect(screen.getByText(/becomes eligible at/i)).toBeVisible()
    // The OLD indefinite sentence must not ALSO render — one message, not
    // a stale one left stacked beside the new one.
    expect(
      screen.queryByText(
        'Windows have been scored, but no lab measurement has arrived for them yet. The join runs again once the configured truth lag has passed.',
      ),
    ).toBeNull()
  })

  it('falls back to the original sentence when earliestEligibleAt is null — no schedule, or nothing awaiting', () => {
    render(
      <EmptyTruth
        error={null}
        coverage={coverage({
          windowsInRange: 3,
          truthRows: 0,
          truthLagMinutes: null,
          earliestEligibleAt: null,
        })}
      />,
    )

    expect(
      screen.getByText(
        'Windows have been scored, but no lab measurement has arrived for them yet. The join runs again once the configured truth lag has passed.',
      ),
    ).toBeVisible()
    expect(screen.queryByText(/becomes eligible at/i)).toBeNull()
  })

  /**
   * MODEL-SERVE-008-T01. The SEVENTH empty cause: the lab's whole window
   * passed and no measurement was reported. Measured live on 2026-09-17 —
   * three windows sat 42h past a 24h lag, joined, empty, and the panel
   * still told the reader to wait for a check that had already happened.
   * The lab reports about once a day (median inter-arrival 24h, read off
   * the model's own GOLD artifact) against an hourly schedule, so this is
   * the COMMON end state, not an anomaly.
   */
  it('says the lab window passed with no report, instead of naming a deadline that is already gone', () => {
    render(
      <EmptyTruth
        error={null}
        coverage={coverage({
          windowsInRange: 3,
          windowsAwaitingTruth: 3,
          windowsLapsedTruth: 3,
          truthRows: 0,
          truthLagMinutes: 1440,
          // Null now by construction — the backend refuses to name a
          // passed deadline. Asserted here so this test still fails if a
          // future change starts producing one again.
          earliestEligibleAt: null,
        })}
      />,
    )

    expect(screen.getByText(/passed their full 24h lab window/i)).toBeVisible()
    expect(screen.getByText(/measurement rate, not a failure/i)).toBeVisible()
    // Neither wait-sentence may render: one is a deadline that has gone,
    // the other an indefinite wait that is over.
    expect(screen.queryByText(/becomes eligible at/i)).toBeNull()
    expect(
      screen.queryByText(/The join runs again once the configured truth lag/i),
    ).toBeNull()
  })

  it('still names the wait when the lag has NOT expired — lapsed and pending are different states', () => {
    render(
      <EmptyTruth
        error={null}
        coverage={coverage({
          windowsInRange: 3,
          windowsAwaitingTruth: 3,
          windowsLapsedTruth: 0,
          truthRows: 0,
          truthLagMinutes: 1440,
          earliestEligibleAt: '2026-09-18T08:00:00.000Z',
        })}
      />,
    )

    expect(screen.getByText(/becomes eligible at/i)).toBeVisible()
    expect(screen.queryByText(/passed their full/i)).toBeNull()
  })

  it('leaves the other empty-cause branches unaffected (negative-space check)', () => {
    // A range with no scored windows at all — a DIFFERENT branch — must
    // never mention a wait it has nothing to do with, even with a
    // schedule's timing fields populated on the coverage object.
    render(
      <EmptyTruth
        error={null}
        coverage={coverage({
          windowsInRange: 0,
          truthLagMinutes: 1440,
          earliestEligibleAt: '2026-09-15T08:00:00.000Z',
        })}
      />,
    )

    expect(
      screen.getByText('No completed inference windows in this range yet.'),
    ).toBeVisible()
    expect(screen.queryByText(/becomes eligible at/i)).toBeNull()
  })
})
