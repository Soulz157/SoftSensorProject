import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { OwnPopulationOverlays } from '../model-selection/own-population-overlays'
import type { CandidateResult } from '@/services/model-draft'

/**
 * MODEL-FLOW-030. The chart frame itself is `candidate-overlay-chart`'s
 * subject; here it is stubbed to expose WHICH population it was given and over
 * WHICH candidates, because the rule under test is routing: each kind of
 * candidate goes to its own population's chart, never the other's.
 */
vi.mock('../model-selection/candidate-overlay-chart', () => ({
  CandidateOverlayChart: (props: {
    population: string
    candidates: { runId: string | null }[]
    byRunId: Map<string, unknown>
    absenceNote?: string
  }) => (
    <div data-testid={`overlay-${props.population}`}>
      <span data-testid={`ids-${props.population}`}>
        {props.candidates.map(c => c.runId).join(',')}
      </span>
      <span data-testid={`series-${props.population}`}>
        {[...props.byRunId.keys()].join(',')}
      </span>
      <span data-testid={`note-${props.population}`}>{props.absenceNote}</span>
    </div>
  ),
}))

function candidate(runId: string, cv: boolean): CandidateResult {
  return {
    runId,
    algorithm: 'ridge',
    hyperparameters: {},
    phase: 1,
    status: 'SUCCEEDED',
    failureReason: null,
    metrics: null,
    trainMetrics: null,
    lossHistoryKey: null,
    lossHistory: null,
    predictionsKey: null,
    cvFoldsKey: cv ? `drafts/d/runs/${runId}/cv_folds.json` : null,
    holdoutPredictionsKey: null,
    scoringContainerId: null,
    sourcedMetrics: [],
    holdoutAbsence: null,
  } as CandidateResult
}

const item = (id: string) => ({ runId: id }) as never

describe('OwnPopulationOverlays (MODEL-FLOW-030)', () => {
  it('a CV-only group gets an out-of-fold chart and NO test-split frame', () => {
    render(
      <OwnPopulationOverlays
        candidates={[candidate('a', true), candidate('b', true)]}
        byRunId={new Map()}
        oofByRunId={new Map([['a', item('a')]])}
      />,
    )
    expect(screen.getByTestId('overlay-cv-oof')).toBeInTheDocument()
    expect(screen.queryByTestId('overlay-test-split')).toBeNull()
    expect(screen.getByTestId('ids-cv-oof').textContent).toBe('a,b')
  })

  it('an ordinary-only group is exactly as before: one test-split chart', () => {
    render(
      <OwnPopulationOverlays
        candidates={[candidate('a', false), candidate('b', false)]}
        byRunId={new Map([['a', item('a')]])}
        oofByRunId={new Map()}
      />,
    )
    expect(screen.getByTestId('overlay-test-split')).toBeInTheDocument()
    expect(screen.queryByTestId('overlay-cv-oof')).toBeNull()
  })

  it('a MIXED group draws each kind on its own population’s chart, never the other’s', () => {
    render(
      <OwnPopulationOverlays
        candidates={[candidate('plain', false), candidate('folded', true)]}
        byRunId={new Map([['plain', item('plain')]])}
        oofByRunId={new Map([['folded', item('folded')]])}
      />,
    )
    expect(screen.getByTestId('ids-test-split').textContent).toBe('plain')
    expect(screen.getByTestId('ids-cv-oof').textContent).toBe('folded')
    // The series handed to each chart are that population's own.
    expect(screen.getByTestId('series-test-split').textContent).toBe('plain')
    expect(screen.getByTestId('series-cv-oof').textContent).toBe('folded')
  })

  it('states the retrain reason for a CV group with no out-of-fold object', () => {
    render(
      <OwnPopulationOverlays
        candidates={[candidate('a', true)]}
        byRunId={new Map()}
        oofByRunId={new Map()}
      />,
    )
    expect(screen.getByTestId('note-cv-oof').textContent).toMatch(
      /Retrain to see this chart/,
    )
  })

  it('renders nothing for an empty group', () => {
    const { container } = render(
      <OwnPopulationOverlays
        candidates={[]}
        byRunId={new Map()}
        oofByRunId={new Map()}
      />,
    )
    expect(container.firstChild).toBeNull()
  })

  it('a FAILED out-of-fold load is not worded as "trained before they were saved"', () => {
    render(
      <OwnPopulationOverlays
        candidates={[candidate('a', true)]}
        byRunId={new Map()}
        oofByRunId={new Map()}
        oofError="Failed to load candidate predictions"
      />,
    )
    const note = screen.getByTestId('note-cv-oof').textContent ?? ''
    expect(note).toMatch(/Could not load the out-of-fold predictions/)
    expect(note).not.toMatch(/Retrain/)
  })
})
