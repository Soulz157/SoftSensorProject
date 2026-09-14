import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { LivePredictionChart } from '../live-prediction-chart'
import { DriftPanel } from '../drift-panel'

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
})
