import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { RetrainComparison } from '@/services/model-retrain'
import type { RunPredictions } from '@/services/model-draft'
import { buildRetrainSeries } from '@/lib/retrain-series'

/**
 * MODEL-SERVE-020-T05. Sections 3 and 4 of the Retrain tab. The prediction
 * hook is mocked (it has its own spec) and the two recharts components are
 * stubs that report what they were handed — jsdom draws no SVG, and what
 * matters here is the arrangement, the labels and what each chart is given.
 */

const hook = vi.fn()
vi.mock('@/hooks/model/use-retrain-predictions', () => ({
  useRetrainPredictions: (args: unknown) => hook(args),
}))

vi.mock(
  '@/app/(default)/models/create/components/pipeline/evaluation/actual-vs-predicted-chart',
  () => ({
    ACTUAL_COLOR: 'var(--foreground)',
    PREDICT_COLOR: 'var(--chart-1)',
    SD_BAND_COLOR: 'var(--chart-2)',
    SD_BAND_OPACITY: 0.42,
    ActualVsPredictedChart: (p: { rows: unknown[]; compareName?: string }) => (
      <div
        data-testid="avp-chart"
        data-rows={p.rows.length}
        data-compare={p.compareName ?? ''}
      />
    ),
  }),
)
vi.mock(
  '@/app/(default)/models/create/components/pipeline/evaluation/residual-chart',
  () => ({
    RESIDUAL_COLOR: 'var(--chart-1)',
    RESIDUAL_LEGEND: [
      { shape: 'square', color: 'var(--chart-1)', label: 'Residual' },
      { shape: 'dashed', color: 'var(--chart-2)', label: '±1 SD' },
    ],
    ResidualChart: (p: { rows: unknown[]; compareName?: string }) => (
      <div
        data-testid="residual-chart"
        data-rows={p.rows.length}
        data-compare={p.compareName ?? ''}
      />
    ),
  }),
)

import { RetrainCharts } from '../retrain-charts'

const BASIS = {
  from: '2026-06-01T00:00:00Z',
  to: '2026-07-01T00:00:00Z',
  rowCount: 259,
  unavailableReason: null,
}

function comparison(
  over: {
    strategy?: 'AUGMENT_DATA' | 'KEEP_EXISTING'
    window?: boolean
    runId?: string | null
  } = {},
): RetrainComparison {
  const strategy = over.strategy ?? 'AUGMENT_DATA'
  const window = over.window ?? true
  return {
    basis: {
      goldArtifactId: 'g',
      artifactChecksum: 'c',
      targetY: 'TI-101',
      split: null,
      comparable: true,
      reason: null,
      strategy,
      evalSet: null,
      trainingComposition: null,
    },
    incumbent: {
      versionId: 'version-1',
      version: 3,
      stage: 'PRODUCTION',
      algorithm: 'ridge',
      sourceRunId: 'run-current',
      metrics: { rmse: 1, r2: 0.9, mae: 0.5 },
      metricsBasis: {
        ...BASIS,
        frame: 'INCUMBENT_TEST_SPLIT',
        usedFor: 'COMPARE_TO_PRODUCTION',
      },
    },
    candidate: {
      runId: over.runId === undefined ? 'run-new' : over.runId,
      versionId: 'version-4',
      version: 4,
      stage: 'STAGING',
      algorithm: 'ridge',
      metrics: { rmse: 0.75, r2: 0.95, mae: 0.3 },
      metricsBasis:
        strategy === 'AUGMENT_DATA'
          ? {
              ...BASIS,
              frame: 'FROZEN_INCUMBENT_TEST',
              usedFor: 'COMPARE_TO_PRODUCTION',
            }
          : null,
      newRegimeMetrics: null,
      newRegimeMetricsBasis: null,
      newDataHoldoutMetrics: window ? { rmse: 1, r2: 0.5, mae: 0.5 } : null,
      newDataHoldoutRowCount: window ? 24 : null,
      newDataHoldoutFrom: null,
      newDataHoldoutTo: null,
      newDataHoldoutBasis: window
        ? {
            ...BASIS,
            rowCount: 24,
            frame: 'NEW_DATA_WINDOW',
            usedFor: 'REPORT_ONLY',
          }
        : {
            ...BASIS,
            rowCount: null,
            frame: 'NEW_DATA_WINDOW',
            usedFor: 'REPORT_ONLY',
            unavailableReason:
              'no new-data window was set aside for this retrain',
          },
    },
    rmseDelta: null,
    selectionMetric: 'rmse',
  }
}

function preds(n: number): RunPredictions {
  return {
    sourceKey: 'k',
    rowCount: n,
    residualSd: 0.5,
    residualRmseCheck: 0.5,
    yTrueMin: 0,
    yTrueMax: 0,
    yPredMin: 0,
    yPredMax: 0,
    points: Array.from({ length: n }, (_, i) => ({
      timestamp: `2026-01-01 ${String(i).padStart(2, '0')}:00:00`,
      yTrue: i,
      yPred: i + 0.5,
    })),
    derivedFromTarget: null,
    targetScaled: false,
  }
}

function ready(opts: {
  rows: number
  overlay?: boolean
  overlayError?: string
}) {
  hook.mockReturnValue({
    status: 'ready',
    series: buildRetrainSeries(
      preds(opts.rows),
      opts.overlay ? preds(opts.rows) : null,
      'Current v3',
    ),
    error: null,
    overlayError: opts.overlayError ?? null,
  })
}

beforeEach(() => {
  hook.mockReset()
})

describe('RetrainCharts', () => {
  it('draws Actual vs Predicted then Residuals, with the current version overlaid', () => {
    ready({ rows: 3, overlay: true })
    render(
      <RetrainCharts
        modelId="model-1"
        comparison={comparison()}
        currentVersion={3}
      />,
    )

    const avp = screen.getByText('Actual vs Predicted')
    const res = screen.getByText('Residuals')
    expect(
      avp.compareDocumentPosition(res) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    expect(screen.getByTestId('avp-chart')).toHaveAttribute(
      'data-compare',
      'Current v3',
    )
    expect(screen.getByTestId('residual-chart')).toHaveAttribute(
      'data-compare',
      'Current v3',
    )
    expect(
      screen.getByText(/Current v3 is drawn on all 3 rows/),
    ).toBeInTheDocument()
    // The legend names both versions, not just "Predicted".
    expect(screen.getAllByText('New v4').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Current v3').length).toBeGreaterThan(0)
  })

  it('names the range and row count of the data being shown', () => {
    ready({ rows: 3 })
    render(
      <RetrainCharts
        modelId="model-1"
        comparison={comparison()}
        currentVersion={3}
      />,
    )
    expect(screen.getByText(/259 rows/)).toBeInTheDocument()
  })

  it('asks the hook for the new version’s comparison series and the current version’s own run', () => {
    ready({ rows: 1 })
    render(
      <RetrainCharts
        modelId="model-1"
        comparison={comparison()}
        currentVersion={3}
      />,
    )
    expect(hook).toHaveBeenCalledWith(
      expect.objectContaining({
        modelId: 'model-1',
        candidateRunId: 'run-new',
        candidatePopulation: 'holdout',
        currentRunId: 'run-current',
        dataSet: 'CURRENT_TEST',
      }),
    )
  })

  it('switches both charts to the new data set aside', async () => {
    const user = userEvent.setup()
    ready({ rows: 1 })
    render(
      <RetrainCharts
        modelId="model-1"
        comparison={comparison()}
        currentVersion={3}
      />,
    )

    await user.click(screen.getByRole('radio', { name: /New data set aside/i }))
    expect(hook).toHaveBeenLastCalledWith(
      expect.objectContaining({ dataSet: 'NEW_DATA' }),
    )
  })

  it('disables the new-data choice, and says why, when nothing was set aside', () => {
    ready({ rows: 1 })
    render(
      <RetrainCharts
        modelId="model-1"
        comparison={comparison({ window: false })}
        currentVersion={3}
      />,
    )
    expect(
      screen.getByRole('radio', { name: /New data set aside/i }),
    ).toBeDisabled()
    expect(
      screen.getByText(/no new-data window was set aside/i),
    ).toBeInTheDocument()
  })

  it('a legacy Keep Existing job reads its own test series and cannot pick new data', () => {
    ready({ rows: 1 })
    render(
      <RetrainCharts
        modelId="model-1"
        comparison={comparison({ strategy: 'KEEP_EXISTING', window: false })}
        currentVersion={3}
      />,
    )
    expect(hook).toHaveBeenCalledWith(
      expect.objectContaining({ candidatePopulation: 'test' }),
    )
    expect(
      screen.getByRole('radio', { name: /New data set aside/i }),
    ).toBeDisabled()
  })

  it('shows the server’s reason instead of a chart when a series is missing', () => {
    hook.mockReturnValue({
      status: 'error',
      series: null,
      error:
        'No predictions were recorded for the new data set aside in this retrain.',
      overlayError: null,
    })
    render(
      <RetrainCharts
        modelId="model-1"
        comparison={comparison()}
        currentVersion={3}
      />,
    )
    expect(
      screen.getByText(
        /No predictions were recorded for the new data set aside/,
      ),
    ).toBeInTheDocument()
    expect(screen.queryByTestId('avp-chart')).not.toBeInTheDocument()
    expect(screen.queryByTestId('residual-chart')).not.toBeInTheDocument()
  })

  it('never draws an empty chart as if it were data', () => {
    ready({ rows: 0 })
    render(
      <RetrainCharts
        modelId="model-1"
        comparison={comparison()}
        currentVersion={3}
      />,
    )
    expect(screen.getByText(/no rows to plot/i)).toBeInTheDocument()
    expect(screen.queryByTestId('avp-chart')).not.toBeInTheDocument()
  })

  it('still draws the new version and says why when the current version could not be overlaid', () => {
    ready({
      rows: 2,
      overlayError:
        'Training run succeeded but recorded no predictions for the test data.',
    })
    render(
      <RetrainCharts
        modelId="model-1"
        comparison={comparison()}
        currentVersion={3}
      />,
    )
    expect(screen.getByTestId('avp-chart')).toHaveAttribute('data-compare', '')
    expect(
      screen.getByText(/Current v3 is not drawn: Training run succeeded/),
    ).toBeInTheDocument()
  })

  it('shows a loading placeholder, not a chart, while the series loads', () => {
    hook.mockReturnValue({
      status: 'loading',
      series: null,
      error: null,
      overlayError: null,
    })
    render(
      <RetrainCharts
        modelId="model-1"
        comparison={comparison()}
        currentVersion={3}
      />,
    )
    expect(screen.queryByTestId('avp-chart')).not.toBeInTheDocument()
  })

  it('renders no internal jargon', () => {
    ready({ rows: 3, overlay: true })
    const { container } = render(
      <RetrainCharts
        modelId="model-1"
        comparison={comparison()}
        currentVersion={3}
      />,
    )
    expect(container.textContent ?? '').not.toMatch(
      /incumbent|frozen|holdout|regime|evalSet|dedupe|merged test split/i,
    )
  })
})
