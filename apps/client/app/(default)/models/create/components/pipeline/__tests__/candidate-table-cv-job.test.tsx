import { describe, it, expect, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { CandidateTable } from '../model-selection/candidate-table'
import type { CandidateResult } from '@/services/model-draft'

/**
 * MODEL-FLOW-029-T05. A cross-validated HYPERPARAMETER_SEARCH puts CV runs on
 * the JOB path of Step 4 for the first time — every variant is a CV run with
 * no bare rmse, and the server picks the lowest fold-mean RMSE. The table
 * must show each variant's own `Est. CV` mean ± std and rank on that same
 * mean, so the server's winner is the row ranked first.
 */
function cvCandidate(
  runId: string,
  rmseMean: number,
  rmseStd: number,
): CandidateResult {
  return {
    runId,
    algorithm: 'ridge',
    hyperparameters: { alpha: rmseMean },
    phase: 1,
    status: 'SUCCEEDED',
    failureReason: null,
    // A CV run's `metrics` carries no bare r2/rmse/mae.
    metrics: null,
    trainMetrics: null,
    lossHistoryKey: null,
    lossHistory: null,
    predictionsKey: null,
    cvFoldsKey: `drafts/d/runs/${runId}/cv_folds.json`,
    holdoutPredictionsKey: null,
    scoringContainerId: null,
    sourcedMetrics: [
      {
        source: 'cv-fold-estimate',
        nSplits: 3,
        mean: { r2: 0.8, rmse: rmseMean, mae: 0.3 },
        std: { r2: 0.02, rmse: rmseStd, mae: 0.01 },
      },
    ],
    holdoutAbsence: 'not-scored-yet',
  } as CandidateResult
}

function renderTable(candidates: CandidateResult[], resolvedRunId: string) {
  return render(
    <CandidateTable
      candidates={candidates}
      resolvedRunId={resolvedRunId}
      selecting={false}
      onSelect={vi.fn()}
      selectedMetrics={['rmse']}
      sortMetric="rmse"
      onSortMetric={vi.fn()}
      byRunId={new Map()}
      holdoutByRunId={new Map()}
      predictionsLoading={false}
      holdoutLoading={false}
    />,
  )
}

describe('CandidateTable with a cross-validated search job (MODEL-FLOW-029)', () => {
  it('shows every variant’s own fold estimate, labelled Est. CV', () => {
    renderTable(
      [cvCandidate('run-a', 0.6, 0.01), cvCandidate('run-b', 0.4, 0.05)],
      'run-b',
    )
    expect(screen.getByText('0.600 ± 0.010')).toBeTruthy()
    expect(screen.getByText('0.400 ± 0.050')).toBeTruthy()
    expect(screen.getAllByText('Est. CV').length).toBeGreaterThanOrEqual(2)
  })

  it('ranks the lowest fold-mean RMSE first — the same rule the server uses to pick the winner', () => {
    renderTable(
      [cvCandidate('run-a', 0.6, 0.01), cvCandidate('run-b', 0.4, 0.05)],
      'run-b',
    )
    const scores = screen
      .getAllByText(/^0\.\d{3} ± 0\.\d{3}$/)
      .map(el => el.textContent)
    expect(scores).toEqual(['0.400 ± 0.050', '0.600 ± 0.010'])
  })

  it('headers the first metric column "Test / CV" when a group has a CV row', () => {
    renderTable([cvCandidate('run-a', 0.6, 0.01)], 'run-a')
    expect(screen.getAllByText('Test / CV').length).toBeGreaterThan(0)
  })

  it('keeps the plain "Test" header for a group with no CV row', () => {
    const plain = {
      ...cvCandidate('run-p', 0.5, 0.01),
      cvFoldsKey: null,
      sourcedMetrics: [{ source: 'test-split', r2: 0.8, rmse: 0.5, mae: 0.3 }],
    } as CandidateResult
    renderTable([plain], 'run-p')
    expect(screen.queryByText('Test / CV')).toBeNull()
    expect(screen.getAllByText('Test').length).toBeGreaterThan(0)
  })

  describe('an opened CV row’s out-of-fold chart', () => {
    function renderOpen(item: unknown, oofError: string | null = null) {
      render(
        <CandidateTable
          candidates={[cvCandidate('run-a', 0.6, 0.01)]}
          resolvedRunId="run-a"
          selecting={false}
          onSelect={vi.fn()}
          selectedMetrics={['rmse']}
          sortMetric="rmse"
          onSortMetric={vi.fn()}
          byRunId={new Map()}
          holdoutByRunId={new Map()}
          oofByRunId={new Map(item ? [['run-a', item as never]] : [])}
          oofError={oofError}
          predictionsLoading={false}
          holdoutLoading={false}
          oofLoading={false}
        />,
      )
      fireEvent.click(screen.getByRole('button', { name: /show charts/i }))
    }

    it('says no out-of-fold predictions are stored, in plain words, when the object is missing', () => {
      // The python reader soft-fails a missing object per item with a raw
      // storage string; the user must never see it.
      renderOpen({
        runId: 'run-a',
        sourceKey: 'k',
        rowCount: null,
        points: [],
        error:
          "Could not read 'drafts/d/runs/run-a/cv_oof_predictions.parquet': NoSuchKey",
      })
      expect(
        screen.getByText(/No out-of-fold predictions are stored/),
      ).toBeInTheDocument()
      expect(screen.queryByText(/NoSuchKey/)).toBeNull()
    })

    it('says it could not LOAD them when the fetch itself failed, not that they are missing', () => {
      renderOpen(null, 'Failed to load candidate predictions')
      expect(
        screen.getByText(/Could not load the out-of-fold predictions/),
      ).toBeInTheDocument()
      expect(screen.queryByText(/Retrain/)).toBeNull()
    })
  })
})
