import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useDraftRunEvaluation } from '../use-draft-run-evaluation'
import { modelDraftRunService, modelDraftService } from '@/services/model-draft'
import { ApiError } from '@/lib/fetcher'
import { clearChartRequestCache } from '@/lib/chart-request-cache'

vi.mock('@/services/model-draft', () => ({
  modelDraftService: { get: vi.fn() },
  modelDraftRunService: {
    get: vi.fn(),
    predictions: vi.fn(),
    score: vi.fn(),
  },
}))

/**
 * MODEL-FLOW-030. The hook loads a run's OWN population and its validation
 * HOLDOUT in one pass. What these pin is behaviour a rendered test cannot see:
 * WHICH population each run kind asks the server for, how each failure is
 * classified, and what a scoring poll tick re-reads.
 */

const PRED = {
  sourceKey: 'k',
  rowCount: 3,
  residualSd: 0.4,
  residualRmseCheck: 0.4,
  yTrueMin: 0,
  yTrueMax: 1,
  yPredMin: 0,
  yPredMax: 1,
  points: [
    { timestamp: '2026-02-08 00:46:00', yTrue: 1, yPred: 0.9 },
    { timestamp: '2026-02-08 00:56:00', yTrue: 2, yPred: 2.1 },
    { timestamp: '2026-02-08 01:06:00', yTrue: 3, yPred: 2.8 },
  ],
  derivedFromTarget: null,
  targetScaled: null,
}

function runDetail(overrides: Record<string, unknown> = {}) {
  return {
    id: 'run-1',
    status: 'SUCCEEDED',
    algorithm: 'ridge',
    targetY: 'TI-101',
    failureReason: null,
    cvFoldsKey: null,
    predictionsKey: 'p',
    holdoutPredictionsKey: null,
    scoringContainerId: null,
    metrics: { r2: 0.9, rmse: 0.5, mae: 0.4 },
    holdoutMetrics: null,
    cvFolds: null,
    featureImportance: null,
    permutationImportance: null,
    splitStats: null,
    sweepId: null,
    sweepSeedRunId: null,
    goldArtifactId: 'g',
    datasetId: 'd',
    ...overrides,
  }
}

const CV_METRICS = {
  n_splits: 3,
  cv_r2_mean: 0.8,
  cv_r2_std: 0.04,
  cv_rmse_mean: 1.5,
  cv_rmse_std: 0.25,
  cv_mae_mean: 1.1,
  cv_mae_std: 0.1,
}

const populationsAsked = () =>
  vi
    .mocked(modelDraftRunService.predictions)
    .mock.calls.map(call => call[2] as string)

function ok<T>(data: T) {
  return { statusCode: 200, message: 'ok', type: 'SUCCESS' as const, data }
}

/** Advance past a poll tick AND let the fetch it starts finish: the tick fires
 *  a zero-delay debounce, then a chain of awaited calls. */
async function pollTick() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(2600)
  })
  await act(async () => {
    await vi.advanceTimersByTimeAsync(200)
  })
}

async function loadFirst() {
  const hook = renderHook(() => useDraftRunEvaluation('draft-1', 'run-1'))
  // First load is debounced (600ms), then the fetch resolves.
  await act(async () => {
    await vi.advanceTimersByTimeAsync(700)
  })
  return hook
}

beforeEach(() => {
  // The request helper caches by draft/run key; without this every case after
  // the first is served the first case's result and never reaches the fetcher.
  clearChartRequestCache()
  vi.useFakeTimers()
  vi.mocked(modelDraftService.get).mockResolvedValue(
    ok({ resolvedRunId: 'run-1' }) as never,
  )
  vi.mocked(modelDraftRunService.predictions).mockResolvedValue(
    ok(PRED) as never,
  )
})

afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
})

describe('which population each run kind asks for', () => {
  it('a normal run reads its TEST split and, unscored, never asks for a holdout series', async () => {
    vi.mocked(modelDraftRunService.get).mockResolvedValue(
      ok(runDetail()) as never,
    )
    const { result } = await loadFirst()

    expect(populationsAsked()).toEqual(['test'])
    expect(result.current.own?.population).toBe('test-split')
    expect(result.current.own?.fit?.n).toBe(3)
    expect(result.current.holdout?.population).toBe('holdout')
    expect(result.current.holdout?.fit).toBeNull()
    expect(result.current.holdout?.absence).toBe('no-series')
  })

  it('a CV run reads its OUT-OF-FOLD series and never the test split', async () => {
    vi.mocked(modelDraftRunService.get).mockResolvedValue(
      ok(
        runDetail({
          cvFoldsKey: 'drafts/d/runs/run-1/cv_folds.json',
          predictionsKey: null,
          metrics: CV_METRICS,
        }),
      ) as never,
    )
    const { result } = await loadFirst()

    expect(populationsAsked()).toEqual(['cv-oof'])
    expect(populationsAsked()).not.toContain('test')
    expect(result.current.own?.population).toBe('cv-oof')
    // Tiles are the FOLD MEAN ± std, not anything recomputed from the series.
    expect(result.current.own?.metrics).toMatchObject({
      rmse: 1.5,
      std: { rmse: 0.25 },
      nSplits: 3,
    })
  })

  it('a scored CV run reads its holdout from predictionsKey; a scored normal run from holdoutPredictionsKey', async () => {
    const holdoutMetrics = { r2: 0.7, rmse: 0.9, mae: 0.6 }
    vi.mocked(modelDraftRunService.get).mockResolvedValue(
      ok(
        runDetail({
          cvFoldsKey: 'drafts/d/runs/run-1/cv_folds.json',
          predictionsKey: 'drafts/d/runs/run-1/holdout.parquet',
          metrics: CV_METRICS,
          holdoutMetrics,
        }),
      ) as never,
    )
    const cv = await loadFirst()
    expect(populationsAsked().sort()).toEqual(['cv-oof', 'holdout'])
    expect(cv.result.current.holdout?.fit?.n).toBe(3)
    cv.unmount()

    // Same draft/run key: without clearing, the second load is a cache hit.
    clearChartRequestCache()
    vi.mocked(modelDraftRunService.predictions).mockClear()
    vi.mocked(modelDraftRunService.get).mockResolvedValue(
      ok(
        runDetail({
          holdoutPredictionsKey: 'drafts/d/runs/run-1/holdout.parquet',
          holdoutMetrics,
        }),
      ) as never,
    )
    await loadFirst()
    expect(populationsAsked().sort()).toEqual(['holdout', 'test'])
  })
})

describe('failure classification', () => {
  const cvRun = () =>
    ok(
      runDetail({
        cvFoldsKey: 'drafts/d/runs/run-1/cv_folds.json',
        predictionsKey: null,
        metrics: CV_METRICS,
      }),
    ) as never

  it('a missing out-of-fold object (404) is no-oof, and the fold tiles survive', async () => {
    vi.mocked(modelDraftRunService.get).mockResolvedValue(cvRun())
    vi.mocked(modelDraftRunService.predictions).mockRejectedValue(
      new ApiError('gone', 404),
    )
    const { result } = await loadFirst()
    expect(result.current.own?.absence).toBe('no-oof')
    expect(result.current.own?.metrics?.rmse).toBe(1.5)
    expect(result.current.error).toBeNull()
  })

  it('an over-cap series (400 naming the cap) is too-large — never decimated', async () => {
    vi.mocked(modelDraftRunService.get).mockResolvedValue(cvRun())
    vi.mocked(modelDraftRunService.predictions).mockRejectedValue(
      new ApiError(
        "'k' has 25000 rows, over the 20000 this endpoint serves without decimation.",
        400,
      ),
    )
    const { result } = await loadFirst()
    expect(result.current.own?.absence).toBe('too-large')
    expect(result.current.own?.fit).toBeNull()
  })

  it('any other read failure is unreadable, not a retrain prompt', async () => {
    vi.mocked(modelDraftRunService.get).mockResolvedValue(cvRun())
    vi.mocked(modelDraftRunService.predictions).mockRejectedValue(
      new ApiError('boom', 502),
    )
    const { result } = await loadFirst()
    expect(result.current.own?.absence).toBe('unreadable')
  })

  it('an over-cap TEST split no longer takes the page down: no error, tiles kept, holdout still loaded', async () => {
    vi.mocked(modelDraftRunService.get).mockResolvedValue(
      ok(
        runDetail({ holdoutMetrics: { r2: 0.7, rmse: 0.9, mae: 0.6 } }),
      ) as never,
    )
    vi.mocked(modelDraftRunService.predictions).mockRejectedValue(
      new ApiError('x has 30000 rows, over the 20000 limit', 400),
    )
    const { result } = await loadFirst()
    expect(result.current.error).toBeNull()
    expect(result.current.own?.absence).toBe('too-large')
    expect(result.current.own?.metrics?.rmse).toBe(0.5)
    expect(result.current.holdout?.metrics?.rmse).toBe(0.9)
  })

  it('a non-cap failure of the TEST split is still a page error (strict, as before)', async () => {
    vi.mocked(modelDraftRunService.get).mockResolvedValue(
      ok(runDetail()) as never,
    )
    vi.mocked(modelDraftRunService.predictions).mockRejectedValue(
      new ApiError('boom', 502),
    )
    const { result } = await loadFirst()
    expect(result.current.error).not.toBeNull()
  })
})

describe('a scoring poll tick', () => {
  it('re-reads the run and the holdout but NOT the unchanged own series', async () => {
    vi.mocked(modelDraftRunService.get).mockResolvedValue(
      ok(runDetail({ scoringContainerId: 'container-1' })) as never,
    )
    await loadFirst()
    expect(populationsAsked()).toEqual(['test'])
    expect(vi.mocked(modelDraftRunService.get)).toHaveBeenCalledTimes(1)

    await pollTick()

    // The run was re-read (that is how scoring finishing is noticed)…
    expect(
      vi.mocked(modelDraftRunService.get).mock.calls.length,
    ).toBeGreaterThan(1)
    // …but the test split — up to 20,000 points through python — was not.
    expect(populationsAsked()).toEqual(['test'])
  })

  it('retries an own series that had failed rather than freezing the failure', async () => {
    vi.mocked(modelDraftRunService.get).mockResolvedValue(
      ok(
        runDetail({
          cvFoldsKey: 'drafts/d/runs/run-1/cv_folds.json',
          predictionsKey: null,
          metrics: CV_METRICS,
          scoringContainerId: 'container-1',
        }),
      ) as never,
    )
    vi.mocked(modelDraftRunService.predictions).mockRejectedValueOnce(
      new ApiError('boom', 502),
    )
    const { result } = await loadFirst()
    expect(result.current.own?.absence).toBe('unreadable')

    await pollTick()
    expect(populationsAsked().filter(p => p === 'cv-oof').length).toBe(2)
    expect(result.current.own?.absence).toBeNull()
  })
})
