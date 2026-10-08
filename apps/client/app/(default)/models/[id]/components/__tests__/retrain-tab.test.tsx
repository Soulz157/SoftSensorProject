import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { RetrainComparison, RetrainJob } from '@/services/model-retrain'
// The charts have their own spec (retrain-charts.test.tsx); here they are a
// stub so this file's subject stays the tab's own arrangement — and so no
// request is attempted for a series in these tests.
vi.mock('../retrain-charts', () => ({
  RetrainCharts: () => <div data-testid="retrain-charts" />,
}))

import { RetrainTab } from '../retrain-tab'

/**
 * MODEL-SERVE-020-T02/T03. The Retrain tab is a composition shell over
 * `RetrainProgress`; these prove what the shell itself owns: the single
 * Retrain entry point, the idle state, and that a finished job's two
 * sections (comparison, then results on the new data) render inside it.
 */

const BASIS = {
  from: '2026-06-01T00:00:00Z',
  to: '2026-07-01T00:00:00Z',
  rowCount: 40,
  unavailableReason: null,
}

function comparison(): RetrainComparison {
  return {
    basis: {
      goldArtifactId: 'gold-1',
      artifactChecksum: 'sha-1',
      targetY: 'TI-101',
      split: { method: 'chronological', ratio: 0.8 },
      comparable: true,
      reason: null,
      strategy: 'AUGMENT_DATA',
      evalSet: { kind: 'FROZEN_INCUMBENT_TEST', checksum: 'x' },
      trainingComposition: {
        baseTrainRowCount: 80,
        newTrainRowCount: 20,
        dedupeDropped: 0,
        cutTimestamp: '2026-06-01T00:00:00Z',
        combinedRowCount: 100,
        fitRowCount: null,
        fitUpTo: null,
        newDataUsedInFit: null,
      },
    },
    incumbent: {
      versionId: 'version-1',
      version: 3,
      stage: 'PRODUCTION',
      algorithm: 'ridge',
      sourceRunId: 'run-incumbent',
      metrics: { rmse: 1.25, r2: 0.9, mae: 0.5 },
      metricsBasis: {
        ...BASIS,
        frame: 'INCUMBENT_TEST_SPLIT',
        usedFor: 'COMPARE_TO_PRODUCTION',
      },
    },
    candidate: {
      runId: 'run-2',
      versionId: 'version-4',
      version: 4,
      stage: 'STAGING',
      algorithm: 'ridge',
      metrics: { rmse: 0.75, r2: 0.95, mae: 0.3 },
      metricsBasis: {
        ...BASIS,
        frame: 'FROZEN_INCUMBENT_TEST',
        usedFor: 'COMPARE_TO_PRODUCTION',
      },
      newRegimeMetrics: { rmse: 2, r2: 0.1, mae: 1 },
      newRegimeMetricsBasis: {
        ...BASIS,
        frame: 'MERGED_TEST_SPLIT',
        usedFor: 'RANK_CANDIDATES',
      },
      newDataHoldoutMetrics: { rmse: 0.42, r2: 0.88, mae: 0.31 },
      newDataHoldoutRowCount: 720,
      newDataHoldoutFrom: '2026-05-01T00:00:00.000Z',
      newDataHoldoutTo: '2026-05-31T23:59:59.999Z',
      newDataHoldoutBasis: {
        ...BASIS,
        frame: 'NEW_DATA_WINDOW',
        usedFor: 'REPORT_ONLY',
      },
    },
    rmseDelta: -0.5,
    selectionMetric: 'rmse',
  }
}

function doneJob(): RetrainJob {
  return {
    id: 'job-1',
    modelId: 'model-1',
    sourceVersionId: 'version-1',
    resultVersionId: 'version-4',
    targetY: 'TI-101',
    goldArtifactId: 'gold-1',
    trainTestSplit: 0.8,
    kind: 'HYPERPARAMETER_SEARCH',
    totalRuns: 4,
    completedRuns: 4,
    status: 'SUCCEEDED',
    failureReason: null,
    currentRunId: null,
    bestRunId: 'run-2',
    bestRmse: 0.75,
    selectedRunId: null,
    idempotencyKey: null,
    createdAt: '2026-09-01T00:00:00Z',
    startedAt: '2026-09-01T00:00:01Z',
    finishedAt: '2026-09-01T00:30:00Z',
    candidates: [],
    comparison: comparison(),
    retrainStrategy: 'AUGMENT_DATA',
    baseDatasetVersionId: null,
    additionalDatasetVersionId: null,
    combinedArtifactId: null,
    cvFolds: null,
    acceptanceCriteria: null,
  }
}

function renderTab(overrides: Partial<Parameters<typeof RetrainTab>[0]> = {}) {
  const props = {
    modelId: 'model-1',
    job: null,
    phase: 'idle' as const,
    logs: [],
    isRetraining: false,
    onStartRetrain: vi.fn(),
    applying: false,
    onApplyToProduction: vi.fn(),
    ...overrides,
  }
  render(<RetrainTab {...props} />)
  return props
}

describe('RetrainTab', () => {
  it('is the one Retrain entry point: the button opens the dialog', async () => {
    const user = userEvent.setup()
    const props = renderTab()

    await user.click(screen.getByRole('button', { name: /^Retrain$/ }))
    expect(props.onStartRetrain).toHaveBeenCalledTimes(1)
  })

  it('says so when there is no retrain yet, instead of an empty tab', () => {
    renderTab()
    expect(screen.getByText(/No retrain to show yet/i)).toBeInTheDocument()
  })

  it('disables the button while a retrain is live', () => {
    renderTab({ isRetraining: true })
    expect(screen.getByRole('button', { name: /Retraining…/ })).toBeDisabled()
  })

  it('shows the comparison first, then the validation on the new data', () => {
    renderTab({ job: doneJob(), phase: 'done' })

    const compare = screen.getByText('Comparison with the current version')
    const newData = screen.getByText('Validation on the new data')
    // DOCUMENT_POSITION_FOLLOWING: the second node comes after the first.
    expect(
      compare.compareDocumentPosition(newData) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    expect(screen.getByText('0.4200')).toBeInTheDocument()
  })

  it('shows the charts after the two metric sections, for a finished job only', () => {
    renderTab({ job: doneJob(), phase: 'done' })
    const newData = screen.getByText('Validation on the new data')
    const charts = screen.getByTestId('retrain-charts')
    expect(
      newData.compareDocumentPosition(charts) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
  })

  it('shows no charts before the job has finished', () => {
    renderTab({
      job: { ...doneJob(), status: 'RUNNING', comparison: null },
      phase: 'training',
    })
    expect(screen.queryByTestId('retrain-charts')).not.toBeInTheDocument()
  })

  it('puts the combined-data score under the comparison, NOT under the new-data heading', () => {
    // That split was 97% old rows on the one real retrain measured, so a
    // heading about the new data over it would be false. `doneJob()` carries a
    // combined-data figure (rmse 2) and a window figure (rmse 0.42).
    renderTab({ job: doneJob(), phase: 'done' })
    const compare = screen.getByText('Comparison with the current version')
    const newData = screen.getByText('Validation on the new data')
    const combined = screen.getByText(/its own test data \(existing \+ new\)/i)
    const pos = (a: Node, b: Node) =>
      a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING
    expect(pos(compare, combined)).toBeTruthy()
    expect(pos(combined, newData)).toBeTruthy()
  })

  it('keeps Apply to Production in the tab and wired to the promote flow', async () => {
    const user = userEvent.setup()
    const props = renderTab({ job: doneJob(), phase: 'done' })

    await user.click(
      screen.getByRole('button', { name: /Apply v4 to Production/i }),
    )
    expect(props.onApplyToProduction).toHaveBeenCalledWith(4)
  })

  it('cannot close a finished result away — on this tab it is the content', () => {
    renderTab({ job: doneJob(), phase: 'done' })
    // The old panel above the stat cards had a per-viewer close; carried over
    // here it would leave an empty tab with nothing to bring the result back.
    expect(
      screen.queryByRole('button', { name: /Close retrain section/i }),
    ).not.toBeInTheDocument()
    expect(
      screen.getByText('Comparison with the current version'),
    ).toBeInTheDocument()
  })

  it('renders no internal jargon anywhere on the tab', () => {
    const { container } = render(
      <RetrainTab
        modelId="model-1"
        job={doneJob()}
        phase="done"
        logs={[]}
        isRetraining={false}
        onStartRetrain={vi.fn()}
        applying={false}
        onApplyToProduction={vi.fn()}
      />,
    )
    expect(container.textContent ?? '').not.toMatch(
      /incumbent|frozen|holdout|regime|evalSet|dedupe|merged test split/i,
    )
  })
})
