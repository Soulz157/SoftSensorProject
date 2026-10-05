import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { AIModel } from '@/types'
import type { RetrainComparison, RetrainJob } from '@/services/model-retrain'

/**
 * MODEL-SERVE-014-T10. The Model Detail retrain surfaces, proven against the
 * REAL contract shapes rather than the deleted simulation: the pre-flight
 * refusal when no PRODUCTION version exists, the comparison's
 * comparable/not-comparable fork, the STAGING-not-deployed wording, and the
 * failure path naming the backend's own reason.
 *
 * `RetrainMonitoringContext` is mocked out — it fetches PSI through
 * `usePredictionMonitoring`, which is the Monitoring tab's own tested
 * surface, not this dialog's subject (T05 is context, never a gate).
 */

const h = vi.hoisted(() => ({
  variants: [{ alpha: 0.01 }, { alpha: 10 }] as Array<
    Record<string, string | number | boolean | null>
  >,
}))

vi.mock('@/services/tuning-grid', () => ({
  tuningGridService: {
    // UNWRAPPED, matching the real endpoint — the earlier enveloped mock
    // is exactly why the broken `res.data.variants` read passed its test
    // while failing against the live server.
    get: (algorithm: string) =>
      Promise.resolve({
        algorithm,
        variants: h.variants,
        maxVariantsPerJob: 4,
      }),
  },
}))

vi.mock('../retrain-monitoring-context', () => ({
  RetrainMonitoringContext: () => <div data-testid="monitoring-context" />,
}))

// MODEL-SERVE-015-T01. RetrainDataStrategy's own dataset list — mocked out
// the same way tuningGridService is above: this file's subject is the
// dialog/progress shell, not the dataset picker's own fetch (no server is
// reachable from these tests).
vi.mock('@/hooks/dataset/use-datasets', () => ({
  useDatasets: () => ({
    datasets: [],
    loading: false,
    refetch: vi.fn(),
    createDataset: vi.fn(),
    deleteDataset: vi.fn(),
    updateDataset: vi.fn(),
  }),
}))

import { ModelRetrainDialog } from '../model-retrain-dialog'
import { RetrainProgress } from '../retrain-progress'

const MODEL = {
  id: 'model-1',
  name: 'Reactor Temp',
  workspaceId: 'ws-1',
} as AIModel
const INCUMBENT = {
  versionId: 'version-1',
  version: 3,
  algorithm: 'ridge' as const,
  baseDataset: null,
  cutTimestamp: null,
  hyperparameters: null,
  trainTestSplit: null,
}

function job(overrides: Partial<RetrainJob> = {}): RetrainJob {
  return {
    id: 'job-1',
    modelId: 'model-1',
    sourceVersionId: 'version-1',
    resultVersionId: null,
    targetY: 'TI-101',
    goldArtifactId: 'gold-1',
    trainTestSplit: 0.8,
    kind: 'HYPERPARAMETER_SEARCH',
    totalRuns: 4,
    completedRuns: 0,
    status: 'RUNNING',
    failureReason: null,
    currentRunId: 'run-1',
    bestRunId: null,
    bestRmse: null,
    selectedRunId: null,
    idempotencyKey: null,
    createdAt: '2026-09-01T00:00:00Z',
    startedAt: '2026-09-01T00:00:01Z',
    finishedAt: null,
    candidates: [],
    comparison: null,
    retrainStrategy: null,
    baseDatasetVersionId: null,
    additionalDatasetVersionId: null,
    combinedArtifactId: null,
    cvFolds: null,
    acceptanceCriteria: null,
    ...overrides,
  }
}

function comparison(
  overrides: Partial<RetrainComparison> = {},
): RetrainComparison {
  return {
    basis: {
      goldArtifactId: 'gold-1',
      artifactChecksum: 'sha-1',
      targetY: 'TI-101',
      split: { method: 'chronological', ratio: 0.8 },
      comparable: true,
      reason: null,
      strategy: 'KEEP_EXISTING',
      evalSet: null,
      trainingComposition: null,
    },
    incumbent: {
      versionId: 'version-1',
      version: 3,
      stage: 'PRODUCTION',
      algorithm: 'ridge',
      sourceRunId: 'run-incumbent',
      metrics: { rmse: 1.25, r2: 0.9, mae: 0.5 },
      metricsBasis: {
        frame: 'INCUMBENT_TEST_SPLIT',
        from: null,
        to: null,
        rowCount: null,
        usedFor: 'COMPARE_TO_PRODUCTION',
        unavailableReason:
          'not recorded for the current production version’s own run',
      },
    },
    candidate: {
      runId: 'run-2',
      versionId: 'version-4',
      version: 4,
      stage: 'STAGING',
      algorithm: 'ridge',
      metrics: { rmse: 0.75, r2: 0.95, mae: 0.3 },
      metricsBasis: null,
      newRegimeMetrics: null,
      newRegimeMetricsBasis: null,
      newDataHoldoutMetrics: null,
      newDataHoldoutRowCount: null,
      newDataHoldoutFrom: null,
      newDataHoldoutTo: null,
      newDataHoldoutBasis: null,
    },
    rmseDelta: -0.5,
    selectionMetric: 'rmse',
    ...overrides,
  }
}

describe('ModelRetrainDialog — pre-flight (T08)', () => {
  it('refuses before submit when the model has no PRODUCTION version', () => {
    const onStart = vi.fn()
    render(
      <ModelRetrainDialog
        open
        onClose={() => {}}
        model={MODEL}
        incumbent={null}
        loading={false}
        isRetraining={false}
        error={null}
        onStart={onStart}
      />,
    )

    expect(screen.getByText(/no PRODUCTION version yet/i)).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /Start Auto Finetune/i }),
    ).toBeDisabled()
    expect(onStart).not.toHaveBeenCalled()
  })

  it('shows the backend error message verbatim when one is present', () => {
    render(
      <ModelRetrainDialog
        open
        onClose={() => {}}
        model={MODEL}
        incumbent={INCUMBENT}
        loading={false}
        isRetraining={false}
        error="Model model-1 already has a retrain in progress (job live-job)."
        onStart={vi.fn()}
      />,
    )

    expect(
      screen.getByText(/already has a retrain in progress/i),
    ).toBeInTheDocument()
  })

  it('disables both start actions while a retrain is live (V04)', () => {
    render(
      <ModelRetrainDialog
        open
        onClose={() => {}}
        model={MODEL}
        incumbent={INCUMBENT}
        loading={false}
        isRetraining
        error={null}
        onStart={vi.fn()}
      />,
    )

    expect(screen.getByRole('button', { name: /Retraining…/i })).toBeDisabled()
  })

  it('does NOT claim "no PRODUCTION version" while the incumbent is still loading', () => {
    render(
      <ModelRetrainDialog
        open
        onClose={() => {}}
        model={MODEL}
        incumbent={null}
        loading
        isRetraining={false}
        error={null}
        onStart={vi.fn()}
      />,
    )

    expect(
      screen.queryByText(/no PRODUCTION version yet/i),
    ).not.toBeInTheDocument()
    expect(
      screen.getByText(/Checking the current production version/i),
    ).toBeInTheDocument()
    // Still not submittable — unknown is not the same as allowed.
    expect(
      screen.getByRole('button', { name: /Start Auto Finetune/i }),
    ).toBeDisabled()
  })

  it('shows the real read failure instead of "no PRODUCTION version" when the fetch failed', () => {
    // The TM3 regression: a promoted model whose `current` read 404s (the
    // route was missing from the running server) was told to promote a
    // version it already had, and the true error was swallowed.
    render(
      <ModelRetrainDialog
        open
        onClose={() => {}}
        model={MODEL}
        incumbent={null}
        loading={false}
        isRetraining={false}
        error="Retrain job not found"
        onStart={vi.fn()}
      />,
    )

    expect(
      screen.queryByText(/no PRODUCTION version yet/i),
    ).not.toBeInTheDocument()
    expect(screen.getByText('Retrain job not found')).toBeInTheDocument()
  })

  // MODEL-SERVE-019-D01. Keep Existing Data is removed — a retrain always
  // ingests new data now, and Start stays disabled until a dataset is
  // chosen (AC: "A retrain cannot start without a committed new dataset
  // version"). This REPLACES the old "starts with no candidates" test,
  // which exercised the now-removed KEEP_EXISTING default (Start was
  // enabled with nothing chosen at all).
  it('Start Auto Finetune stays disabled until a dataset version is chosen', async () => {
    const onStart = vi.fn()
    render(
      <ModelRetrainDialog
        open
        onClose={() => {}}
        model={MODEL}
        incumbent={INCUMBENT}
        loading={false}
        isRetraining={false}
        error={null}
        onStart={onStart}
      />,
    )

    expect(
      screen.getByRole('button', { name: /Start Auto Finetune/i }),
    ).toBeDisabled()
    expect(onStart).not.toHaveBeenCalled()
  })

  // MODEL-SERVE-017/019. The operator's first decision is what the training
  // data IS ("Existing + new data" or "New data only"); picking where it
  // comes from is the second, separate step.
  it('offers only the two new-data strategies, and blocks start until a dataset is chosen', async () => {
    const user = userEvent.setup()
    const onStart = vi.fn()
    render(
      <ModelRetrainDialog
        open
        onClose={() => {}}
        model={MODEL}
        // A resolved base dataset is what makes either new-data strategy
        // selectable at all — without one there is nothing to be compatible
        // WITH, and both options stay disabled by design.
        incumbent={{
          ...INCUMBENT,
          baseDataset: {
            datasetId: 'ds-1',
            datasetName: 'Reactor tags',
            versionId: 'dv-1',
            versionNumber: 3,
          },
        }}
        loading={false}
        isRetraining={false}
        error={null}
        onStart={onStart}
      />,
    )

    // Keep Existing Data is gone — exactly two strategies remain.
    expect(screen.queryByText(/Keep Existing Data/i)).not.toBeInTheDocument()
    expect(screen.getByText('Existing + new data')).toBeInTheDocument()
    expect(screen.getByText('New data only')).toBeInTheDocument()

    await user.click(screen.getByRole('radio', { name: /New data only/i }))

    // Chosen but no dataset picked yet — starting now would submit a
    // strategy the server refuses (its .strict() schema requires the id),
    // so the action stays disabled rather than round-tripping to a 400.
    expect(
      screen.getByRole('button', { name: /Start Auto Finetune/i }),
    ).toBeDisabled()
    expect(onStart).not.toHaveBeenCalled()
  })

  it('pins a Custom Finetune candidate to the incumbent algorithm', async () => {
    const user = userEvent.setup()
    const onStart = vi.fn()
    render(
      <ModelRetrainDialog
        open
        onClose={() => {}}
        model={MODEL}
        incumbent={INCUMBENT}
        loading={false}
        isRetraining={false}
        error={null}
        onStart={onStart}
      />,
    )

    await user.click(screen.getByRole('tab', { name: /Custom Finetune/i }))
    // The algorithm is shown, not chosen — it is the incumbent's own.
    expect(
      await screen.findByText(/same as the current version/),
    ).toBeInTheDocument()

    // MODEL-SERVE-019-D01. Custom Finetune pins the algorithm (proven
    // above), but Start stays disabled without a chosen dataset —
    // this file's `useDatasets` mock returns none, so a full "picks a
    // dataset then starts" round trip is covered live/manually, not here.
    expect(
      screen.getByRole('button', { name: /Start Custom Finetune/i }),
    ).toBeDisabled()
    expect(onStart).not.toHaveBeenCalled()
  })
})

describe('RetrainProgress — result (T04/T06)', () => {
  it('renders nothing when idle', () => {
    const { container } = render(
      <RetrainProgress job={null} phase="idle" logs={[]} />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('shows real container log lines while running', () => {
    render(
      <RetrainProgress
        job={job()}
        phase="training"
        logs={[
          { id: 'l1', level: 'info', message: 'loading gold artifact' },
          { id: 'l2', level: 'info', message: 'fitting ridge alpha=0.01' },
        ]}
      />,
    )
    expect(screen.getByText('loading gold artifact')).toBeInTheDocument()
    expect(screen.getByText('fitting ridge alpha=0.01')).toBeInTheDocument()
  })

  it('names the backend failure reason, never a generic retry line', () => {
    render(
      <RetrainProgress
        job={job({
          status: 'FAILED',
          failureReason: 'Could not launch the first candidate: no image',
        })}
        phase="error"
        logs={[]}
      />,
    )
    expect(
      screen.getByText(/Could not launch the first candidate: no image/),
    ).toBeInTheDocument()
  })

  it('shows the STAGING version and says PRODUCTION is unchanged — never "deployed"', () => {
    render(
      <RetrainProgress
        job={job({
          status: 'SUCCEEDED',
          completedRuns: 4,
          resultVersionId: 'version-4',
          comparison: comparison(),
        })}
        phase="done"
        logs={[]}
      />,
    )

    expect(screen.getByText('v4 — STAGING')).toBeInTheDocument()
    expect(
      screen.getByText(/current v3 stays in production until you apply it/i),
    ).toBeInTheDocument()
    expect(screen.queryByText(/deployed/i)).not.toBeInTheDocument()
  })

  it('offers Apply to Production for a STAGING candidate, minting the real version', async () => {
    const user = userEvent.setup()
    const onApply = vi.fn()
    render(
      <RetrainProgress
        job={job({ status: 'SUCCEEDED', comparison: comparison() })}
        phase="done"
        logs={[]}
        onApplyToProduction={onApply}
      />,
    )

    await user.click(
      screen.getByRole('button', { name: /Apply v4 to Production/i }),
    )
    expect(onApply).toHaveBeenCalledWith(4)
  })

  it('reports the new-data holdout as its own figure, with no delta against the incumbent', () => {
    render(
      <RetrainProgress
        job={job({
          status: 'SUCCEEDED',
          comparison: comparison({
            candidate: {
              runId: 'run-2',
              versionId: 'version-4',
              version: 4,
              stage: 'STAGING',
              algorithm: 'ridge',
              metrics: { rmse: 0.75, r2: 0.95, mae: 0.3 },
              metricsBasis: null,
              newRegimeMetrics: null,
              newRegimeMetricsBasis: null,
              newDataHoldoutMetrics: { rmse: 0.42, r2: 0.88, mae: 0.31 },
              newDataHoldoutRowCount: 720,
              newDataHoldoutFrom: '2026-05-01T00:00:00.000Z',
              newDataHoldoutTo: '2026-05-31T23:59:59.999Z',
              newDataHoldoutBasis: null,
            },
          }),
        })}
        phase="done"
        logs={[]}
      />,
    )

    expect(screen.getByText(/Performance on the new data/i)).toBeInTheDocument()
    expect(screen.getByText('0.4200')).toBeInTheDocument()
    // States what it was measured on.
    expect(screen.getByText(/720 rows/)).toBeInTheDocument()
    // THE correctness assertion: the incumbent was never scored on these
    // rows, so this figure must never be presented as a comparison.
    expect(
      screen.getByText(/Not compared against the current model/i),
    ).toBeInTheDocument()
  })

  it('shows no new-data panel when the retrain carved out no window', () => {
    render(
      <RetrainProgress
        job={job({ status: 'SUCCEEDED', comparison: comparison() })}
        phase="done"
        logs={[]}
      />,
    )

    expect(
      screen.queryByText(/Performance on the new data/i),
    ).not.toBeInTheDocument()
  })

  it('offers no Apply action before a version has been minted', () => {
    render(
      <RetrainProgress
        job={job({
          status: 'SUCCEEDED',
          comparison: comparison({
            candidate: {
              runId: 'run-2',
              versionId: null,
              version: null,
              stage: null,
              algorithm: 'ridge',
              metrics: { rmse: 0.75, r2: 0.95, mae: 0.3 },
              metricsBasis: null,
              newRegimeMetrics: null,
              newRegimeMetricsBasis: null,
              newDataHoldoutMetrics: null,
              newDataHoldoutRowCount: null,
              newDataHoldoutFrom: null,
              newDataHoldoutTo: null,
              newDataHoldoutBasis: null,
            },
          }),
        })}
        phase="done"
        logs={[]}
        onApplyToProduction={vi.fn()}
      />,
    )

    expect(
      screen.queryByRole('button', { name: /Apply .* to Production/i }),
    ).not.toBeInTheDocument()
  })

  it('offers no Apply action once the candidate is already PRODUCTION', () => {
    render(
      <RetrainProgress
        job={job({
          status: 'SUCCEEDED',
          comparison: comparison({
            candidate: {
              runId: 'run-2',
              versionId: 'version-4',
              version: 4,
              stage: 'PRODUCTION',
              algorithm: 'ridge',
              metrics: { rmse: 0.75, r2: 0.95, mae: 0.3 },
              metricsBasis: null,
              newRegimeMetrics: null,
              newRegimeMetricsBasis: null,
              newDataHoldoutMetrics: null,
              newDataHoldoutRowCount: null,
              newDataHoldoutFrom: null,
              newDataHoldoutTo: null,
              newDataHoldoutBasis: null,
            },
          }),
        })}
        phase="done"
        logs={[]}
        onApplyToProduction={vi.fn()}
      />,
    )

    expect(
      screen.queryByRole('button', { name: /Apply .* to Production/i }),
    ).not.toBeInTheDocument()
  })

  it('offers a close control on a finished result, and on a running job', async () => {
    const user = userEvent.setup()
    const onDismiss = vi.fn()

    const { unmount } = render(
      <RetrainProgress
        job={job({ status: 'SUCCEEDED', comparison: comparison() })}
        phase="done"
        logs={[]}
        onDismiss={onDismiss}
      />,
    )
    await user.click(
      screen.getByRole('button', { name: /Close retrain section/i }),
    )
    expect(onDismiss).toHaveBeenCalledTimes(1)
    unmount()

    render(
      <RetrainProgress
        job={job()}
        phase="training"
        logs={[]}
        onDismiss={onDismiss}
      />,
    )
    await user.click(
      screen.getByRole('button', { name: /Close retrain section/i }),
    )
    expect(onDismiss).toHaveBeenCalledTimes(2)
  })

  it('offers a close control on a FAILED job without hiding its reason', async () => {
    const user = userEvent.setup()
    const onDismiss = vi.fn()
    render(
      <RetrainProgress
        job={job({ status: 'FAILED', failureReason: 'no image' })}
        phase="error"
        logs={[]}
        onDismiss={onDismiss}
      />,
    )

    expect(screen.getByText(/no image/)).toBeInTheDocument()
    await user.click(
      screen.getByRole('button', { name: /Close retrain section/i }),
    )
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('shows no close control when the caller provides no handler', () => {
    render(
      <RetrainProgress
        job={job({ status: 'SUCCEEDED', comparison: comparison() })}
        phase="done"
        logs={[]}
      />,
    )
    expect(
      screen.queryByRole('button', { name: /Close retrain section/i }),
    ).not.toBeInTheDocument()
  })

  it('names the real current version rather than the word "incumbent"', () => {
    render(
      <RetrainProgress
        job={job({ status: 'SUCCEEDED', comparison: comparison() })}
        phase="done"
        logs={[]}
      />,
    )

    expect(screen.getAllByText('Current v3').length).toBeGreaterThanOrEqual(3)
    expect(screen.getByText('1.2500')).toBeInTheDocument()
    expect(screen.queryByText(/incumbent/i)).not.toBeInTheDocument()
  })

  it('prints the RMSE delta beside both sides when the basis is comparable', () => {
    render(
      <RetrainProgress
        job={job({ status: 'SUCCEEDED', comparison: comparison() })}
        phase="done"
        logs={[]}
      />,
    )

    expect(screen.getByText('0.7500')).toBeInTheDocument()
    expect(screen.getByText('1.2500')).toBeInTheDocument()
    expect(screen.getByText(/improved/i)).toBeInTheDocument()
    // The RMSE card carries the 0.5000 difference too, and says which side
    // it favours in words, not color.
    expect(
      screen.getAllByText('New better').map(el => el.closest('p')?.textContent),
    ).toContain('▼ 0.5000 lower — New better')
  })

  it('states the reason and shows no delta when the bases are not comparable', () => {
    render(
      <RetrainProgress
        job={job({
          status: 'SUCCEEDED',
          comparison: comparison({
            basis: {
              goldArtifactId: 'gold-1',
              artifactChecksum: 'sha-1',
              targetY: 'TI-101',
              split: { method: 'chronological', ratio: 0.8 },
              comparable: false,
              reason: 'different training artifact',
              strategy: 'KEEP_EXISTING',
              evalSet: null,
              trainingComposition: null,
            },
            rmseDelta: null,
          }),
        })}
        phase="done"
        logs={[]}
      />,
    )

    expect(screen.getByText(/different training artifact/i)).toBeInTheDocument()
    expect(screen.queryByText(/improved|regressed/i)).not.toBeInTheDocument()
    // Both raw metric triples stay on screen even with no delta.
    expect(screen.getByText('0.7500')).toBeInTheDocument()
    expect(screen.getByText('1.2500')).toBeInTheDocument()
    expect(screen.queryByText(/New (better|worse)/)).not.toBeInTheDocument()
  })

  // MODEL-SERVE-019. User rule (2026-09-28): none of these words ever reach
  // the screen — every one is internal vocabulary that has a plain-language
  // mapping in lib/retrain-basis.ts. Rendered against a FULLY populated
  // AUGMENT_DATA comparison (every basis filled in), the case most likely to
  // leak an unmapped code straight onto the page.
  it('renders no internal jargon for a fully-populated AUGMENT_DATA result', () => {
    const FULL_BASIS = {
      frame: 'FROZEN_INCUMBENT_TEST' as const,
      from: '2026-06-01T00:00:00Z',
      to: '2026-07-01T00:00:00Z',
      rowCount: 40,
      usedFor: 'COMPARE_TO_PRODUCTION' as const,
      unavailableReason: null,
    }
    const { container } = render(
      <RetrainProgress
        job={job({
          status: 'SUCCEEDED',
          retrainStrategy: 'AUGMENT_DATA',
          comparison: comparison({
            basis: {
              goldArtifactId: 'gold-1',
              artifactChecksum: 'sha-1',
              targetY: 'TI-101',
              split: { method: 'chronological', ratio: 0.8 },
              comparable: true,
              reason: null,
              strategy: 'AUGMENT_DATA',
              evalSet: {
                kind: 'FROZEN_INCUMBENT_TEST',
                checksum: 'frozen-sha',
              },
              trainingComposition: {
                baseTrainRowCount: 80,
                newTrainRowCount: 20,
                dedupeDropped: 2,
                cutTimestamp: '2026-06-01T00:00:00Z',
                combinedRowCount: 98,
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
              metricsBasis: { ...FULL_BASIS, frame: 'INCUMBENT_TEST_SPLIT' },
            },
            candidate: {
              runId: 'run-2',
              versionId: 'version-4',
              version: 4,
              stage: 'STAGING',
              algorithm: 'ridge',
              metrics: { rmse: 0.75, r2: 0.95, mae: 0.3 },
              metricsBasis: FULL_BASIS,
              newRegimeMetrics: { rmse: 5.0, r2: -2.0, mae: 3.0 },
              newRegimeMetricsBasis: {
                ...FULL_BASIS,
                frame: 'MERGED_TEST_SPLIT',
                usedFor: 'RANK_CANDIDATES',
              },
              newDataHoldoutMetrics: { rmse: 1.1, r2: 0.5, mae: 0.6 },
              newDataHoldoutRowCount: 10,
              newDataHoldoutFrom: '2026-07-01T00:00:00.000Z',
              newDataHoldoutTo: '2026-07-15T00:00:00.000Z',
              newDataHoldoutBasis: {
                ...FULL_BASIS,
                frame: 'NEW_DATA_WINDOW',
                usedFor: 'REPORT_ONLY',
              },
            },
          }),
        })}
        phase="done"
        logs={[]}
        onApplyToProduction={vi.fn()}
      />,
    )

    const text = container.textContent ?? ''
    expect(text).not.toMatch(
      /incumbent|frozen|holdout|regime|evalSet|dedupe|merged test split/i,
    )
  })
})
