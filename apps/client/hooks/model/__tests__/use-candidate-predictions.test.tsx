import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import {
  chunkRunIds,
  MAX_PREDICTION_BATCH_RUN_IDS,
  useCandidatePredictions,
} from '../use-candidate-predictions'
import { modelDraftRunService } from '@/services/model-draft'
import type { RunPredictionsBatchItem } from '@/services/model-draft'

vi.mock('@/services/model-draft', () => ({
  modelDraftRunService: { predictionsBatch: vi.fn() },
}))

const ids = (n: number) => Array.from({ length: n }, (_, i) => `run-${i}`)

function item(runId: string): RunPredictionsBatchItem {
  return {
    runId,
    sourceKey: `k/${runId}`,
    rowCount: 0,
    residualSd: 0,
    residualRmseCheck: 0,
    yTrueMin: 0,
    yTrueMax: 0,
    yPredMin: 0,
    yPredMax: 0,
    points: [],
    downsampled: false,
    error: null,
  }
}

beforeEach(() => {
  vi.mocked(modelDraftRunService.predictionsBatch).mockImplementation(
    async (_d, runIds) => ({
      statusCode: 200,
      message: 'ok',
      type: 'SUCCESS',
      data: { results: runIds.map(item) },
    }),
  )
})

describe('chunkRunIds (MODEL-FLOW-030)', () => {
  it('keeps a small list in one request', () => {
    expect(chunkRunIds(ids(5))).toHaveLength(1)
  })

  it('never exceeds the server cap in one request', () => {
    const chunks = chunkRunIds(ids(MAX_PREDICTION_BATCH_RUN_IDS * 2 + 1))
    expect(chunks.map(c => c.length)).toEqual([24, 24, 1])
  })

  it('preserves every id exactly once, in order', () => {
    expect(chunkRunIds(ids(30)).flat()).toEqual(ids(30))
  })

  it('is empty for no ids', () => {
    expect(chunkRunIds([])).toEqual([])
  })
})

describe('useCandidatePredictions with more runs than the batch cap', () => {
  it('splits into several requests and merges every run by id', async () => {
    const runIds = ids(30)
    const { result } = renderHook(() =>
      useCandidatePredictions('draft-1', runIds, 'cv-oof'),
    )
    await waitFor(() => expect(result.current.loading).toBe(false))

    const calls = vi.mocked(modelDraftRunService.predictionsBatch).mock.calls
    expect(calls).toHaveLength(2)
    for (const call of calls) {
      expect(call[1].length).toBeLessThanOrEqual(MAX_PREDICTION_BATCH_RUN_IDS)
      expect(call[2]).toBe('cv-oof')
    }
    expect(result.current.byRunId.size).toBe(30)
    expect(result.current.error).toBeNull()
  })
})
