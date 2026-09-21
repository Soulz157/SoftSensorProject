import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { ApiError } from '@/lib/fetcher'
import type {
  CurrentRetrainState,
  RetrainJob,
} from '@/services/model-retrain'
import type { AIModel } from '@/types'

const trigger = vi.fn()
const get = vi.fn()
const current = vi.fn()
const getRun = vi.fn()

vi.mock('@/services/model-retrain', () => ({
  modelRetrainService: {
    trigger: (...a: unknown[]) => trigger(...a),
    get: (...a: unknown[]) => get(...a),
    current: (...a: unknown[]) => current(...a),
  },
  modelRunLogsService: {
    get: (...a: unknown[]) => getRun(...a),
  },
}))

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

import { useModelRetrain } from '../use-model-retrain'

const MODEL = { id: 'model-1', name: 'Reactor Temp' } as AIModel

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
    ...overrides,
  }
}

const INCUMBENT = {
  versionId: 'version-1',
  version: 3,
  algorithm: 'xgboost' as const,
}

function currentState(
  overrides: Partial<CurrentRetrainState> = {},
): CurrentRetrainState {
  return { incumbent: INCUMBENT, job: null, ...overrides }
}

const ok = <T,>(data: T) => ({
  data,
  statusCode: 200,
  message: 'ok',
  type: 'SUCCESS',
})

beforeEach(() => {
  vi.clearAllMocks()
  getRun.mockResolvedValue({
    id: 'run-1',
    status: 'RUNNING',
    failureReason: null,
    logs: [{ id: 'log-1', level: 'info', message: 'fit started', createdAt: '' }],
  })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('useModelRetrain — restoring server state (T03/T07, V02)', () => {
  it('reconstructs an in-flight job from the server on mount, without a trigger', async () => {
    current.mockResolvedValue(ok(currentState({ job: job() })))

    const { result } = renderHook(() => useModelRetrain({ model: MODEL }))

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(current).toHaveBeenCalledWith('model-1')
    expect(trigger).not.toHaveBeenCalled()
    expect(result.current.job?.id).toBe('job-1')
    expect(result.current.isRetraining).toBe(true)
    expect(result.current.phase).toBe('training')
  })

  it('reports the incumbent so the dialog can pre-flight, and stays idle with no job', async () => {
    current.mockResolvedValue(ok(currentState()))

    const { result } = renderHook(() => useModelRetrain({ model: MODEL }))

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.incumbent).toEqual(INCUMBENT)
    expect(result.current.job).toBeNull()
    expect(result.current.phase).toBe('idle')
    expect(result.current.isRetraining).toBe(false)
  })

  it('surfaces a null incumbent (no PRODUCTION version) rather than inventing one', async () => {
    current.mockResolvedValue(ok(currentState({ incumbent: null })))

    const { result } = renderHook(() => useModelRetrain({ model: MODEL }))

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.incumbent).toBeNull()
  })

  it('loads the real container logs for the current run — never scripted lines', async () => {
    current.mockResolvedValue(ok(currentState({ job: job() })))

    const { result } = renderHook(() => useModelRetrain({ model: MODEL }))

    await waitFor(() => expect(result.current.logs.length).toBe(1))
    expect(getRun).toHaveBeenCalledWith('model-1', 'run-1')
    expect(result.current.logs[0]?.message).toBe('fit started')
  })
})

describe('useModelRetrain — closing the section (per-viewer)', () => {
  beforeEach(() => {
    try {
      localStorage.clear()
    } catch {
      // ignored — the hook must work without it either way
    }
  })

  it('is not dismissed by default, and reports dismissed after closing', async () => {
    current.mockResolvedValue(ok(currentState({ job: job() })))

    const { result } = renderHook(() => useModelRetrain({ model: MODEL }))
    await waitFor(() => expect(result.current.job).not.toBeNull())
    expect(result.current.dismissed).toBe(false)

    act(() => result.current.dismiss())
    expect(result.current.dismissed).toBe(true)
  })

  it('remembers the dismissal across a remount — the server re-sends the same job', async () => {
    current.mockResolvedValue(ok(currentState({ job: job() })))

    const first = renderHook(() => useModelRetrain({ model: MODEL }))
    await waitFor(() => expect(first.result.current.job).not.toBeNull())
    act(() => first.result.current.dismiss())
    first.unmount()

    const second = renderHook(() => useModelRetrain({ model: MODEL }))
    await waitFor(() => expect(second.result.current.job).not.toBeNull())
    expect(second.result.current.dismissed).toBe(true)
  })

  it('does NOT suppress a different job — a later retrain is new information', async () => {
    current.mockResolvedValueOnce(ok(currentState({ job: job({ id: 'job-1' }) })))

    const first = renderHook(() => useModelRetrain({ model: MODEL }))
    await waitFor(() => expect(first.result.current.job).not.toBeNull())
    act(() => first.result.current.dismiss())
    first.unmount()

    current.mockResolvedValue(ok(currentState({ job: job({ id: 'job-2' }) })))
    const second = renderHook(() => useModelRetrain({ model: MODEL }))
    await waitFor(() => expect(second.result.current.job?.id).toBe('job-2'))
    expect(second.result.current.dismissed).toBe(false)
  })

  it('re-opens the section when the viewer starts a new retrain', async () => {
    current.mockResolvedValue(ok(currentState({ job: job({ status: 'FAILED' }) })))
    trigger.mockResolvedValue({ ...ok(job({ id: 'job-new' })), statusCode: 201 })

    const { result } = renderHook(() => useModelRetrain({ model: MODEL }))
    await waitFor(() => expect(result.current.job).not.toBeNull())
    act(() => result.current.dismiss())
    expect(result.current.dismissed).toBe(true)

    await act(async () => {
      await result.current.start()
    })
    expect(result.current.dismissed).toBe(false)
  })
})

describe('useModelRetrain — triggering (T02, V05)', () => {
  it('POSTs a real retrain and adopts the returned job', async () => {
    current.mockResolvedValue(ok(currentState()))
    trigger.mockResolvedValue({ ...ok(job()), statusCode: 201 })

    const { result } = renderHook(() => useModelRetrain({ model: MODEL }))
    await waitFor(() => expect(result.current.loading).toBe(false))

    await act(async () => {
      await result.current.start()
    })

    expect(trigger).toHaveBeenCalledTimes(1)
    const [modelId, body] = trigger.mock.calls[0] as [
      string,
      { idempotencyKey: string; candidates?: unknown },
    ]
    expect(modelId).toBe('model-1')
    expect(body.idempotencyKey).toBeTruthy()
    expect(body.candidates).toBeUndefined()
    expect(result.current.job?.id).toBe('job-1')
    expect(result.current.isRetraining).toBe(true)
  })

  it('passes Custom Finetune candidates through unchanged', async () => {
    current.mockResolvedValue(ok(currentState()))
    trigger.mockResolvedValue({ ...ok(job()), statusCode: 201 })

    const { result } = renderHook(() => useModelRetrain({ model: MODEL }))
    await waitFor(() => expect(result.current.loading).toBe(false))

    const candidates = [
      { algorithm: 'xgboost' as const, hyperparameters: { alpha: 1 } },
    ]
    await act(async () => {
      await result.current.start(candidates)
    })

    const [, body] = trigger.mock.calls[0] as [
      string,
      { candidates?: unknown },
    ]
    expect(body.candidates).toEqual(candidates)
  })

  it('treats a 200 idempotent replay exactly like a fresh 201', async () => {
    current.mockResolvedValue(ok(currentState()))
    // The backend returns the ORIGINAL job with 200 on an idempotency-key replay.
    trigger.mockResolvedValue({ ...ok(job({ id: 'original-job' })), statusCode: 200 })

    const { result } = renderHook(() => useModelRetrain({ model: MODEL }))
    await waitFor(() => expect(result.current.loading).toBe(false))

    await act(async () => {
      await result.current.start()
    })

    expect(result.current.job?.id).toBe('original-job')
    expect(result.current.error).toBeNull()
  })

  it('does not POST a second time while a retrain is already live (V04)', async () => {
    current.mockResolvedValue(ok(currentState({ job: job() })))

    const { result } = renderHook(() => useModelRetrain({ model: MODEL }))
    await waitFor(() => expect(result.current.isRetraining).toBe(true))

    await act(async () => {
      await result.current.start()
    })

    expect(trigger).not.toHaveBeenCalled()
  })
})

describe('useModelRetrain — errors and conflict (T07/T08)', () => {
  it('recovers the real in-flight job from the server on 409, never parsing the message', async () => {
    current
      .mockResolvedValueOnce(ok(currentState()))
      .mockResolvedValueOnce(ok(currentState({ job: job({ id: 'live-job' }) })))
    trigger.mockRejectedValue(
      new ApiError(
        'Model model-1 already has a retrain in progress (job live-job). Wait for it to finish.',
        409,
      ),
    )

    const { result } = renderHook(() => useModelRetrain({ model: MODEL }))
    await waitFor(() => expect(result.current.loading).toBe(false))

    await act(async () => {
      await result.current.start()
    })

    // The id came from the second `current()` read, not from the prose.
    expect(current).toHaveBeenCalledTimes(2)
    expect(result.current.job?.id).toBe('live-job')
    expect(result.current.error).toContain('already has a retrain in progress')
  })

  it('surfaces the backend message verbatim for a validation refusal and stays idle', async () => {
    current.mockResolvedValue(ok(currentState()))
    trigger.mockRejectedValue(
      new ApiError(
        'Version 3 was fitted with expanding-window cross-validation.',
        422,
      ),
    )

    const { result } = renderHook(() => useModelRetrain({ model: MODEL }))
    await waitFor(() => expect(result.current.loading).toBe(false))

    await act(async () => {
      await result.current.start()
    })

    expect(result.current.error).toBe(
      'Version 3 was fitted with expanding-window cross-validation.',
    )
    // A refused trigger must never look like a running retrain.
    expect(result.current.job).toBeNull()
    expect(result.current.isRetraining).toBe(false)
    expect(result.current.phase).toBe('idle')
  })

  it('exposes the backend failure reason for a FAILED job, and never reports done', async () => {
    current.mockResolvedValue(
      ok(
        currentState({
          job: job({
            status: 'FAILED',
            failureReason: 'Could not launch the first candidate',
            finishedAt: '2026-09-01T00:05:00Z',
          }),
        }),
      ),
    )

    const { result } = renderHook(() => useModelRetrain({ model: MODEL }))

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.phase).toBe('error')
    expect(result.current.job?.failureReason).toBe(
      'Could not launch the first candidate',
    )
    expect(result.current.isRetraining).toBe(false)
  })
})

describe('useModelRetrain — polling to completion (T03, V03)', () => {
  it('polls the live job and stops once it reaches a terminal state', async () => {
    vi.useFakeTimers()
    current.mockResolvedValue(ok(currentState({ job: job() })))
    get.mockResolvedValue(
      ok(
        job({
          status: 'SUCCEEDED',
          completedRuns: 4,
          resultVersionId: 'version-4',
          finishedAt: '2026-09-01T00:30:00Z',
          comparison: {
            basis: {
              goldArtifactId: 'gold-1',
              artifactChecksum: 'sha-1',
              targetY: 'TI-101',
              split: { method: 'chronological', ratio: 0.8 },
              comparable: true,
              reason: null,
            },
            incumbent: {
              versionId: 'version-1',
              version: 3,
              stage: 'PRODUCTION',
              algorithm: 'xgboost',
              metrics: { rmse: 1, r2: 0.9, mae: 0.5 },
            },
            candidate: {
              runId: 'run-2',
              versionId: 'version-4',
              version: 4,
              stage: 'STAGING',
              algorithm: 'xgboost',
              metrics: { rmse: 0.5, r2: 0.95, mae: 0.3 },
            },
            rmseDelta: -0.5,
            selectionMetric: 'rmse',
          },
        }),
      ),
    )

    const { result } = renderHook(() => useModelRetrain({ model: MODEL }))
    await vi.waitFor(() => expect(result.current.isRetraining).toBe(true))

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2500)
    })

    expect(get).toHaveBeenCalledWith('model-1', 'job-1')
    expect(result.current.phase).toBe('done')
    // The STAGING version the backend minted — PRODUCTION stays v3.
    expect(result.current.comparison?.candidate.stage).toBe('STAGING')
    expect(result.current.comparison?.candidate.version).toBe(4)
    expect(result.current.comparison?.incumbent.stage).toBe('PRODUCTION')
    expect(result.current.isRetraining).toBe(false)

    const callsAfterTerminal = get.mock.calls.length
    await act(async () => {
      await vi.advanceTimersByTimeAsync(7500)
    })
    // Polling stopped — no further reads once the job is terminal.
    expect(get.mock.calls.length).toBe(callsAfterTerminal)
  })
})
