import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import type { Algorithm, HyperparamValue } from '@/store/model-pipeline'
import { defaultHyperparams } from '@/lib/training-config'
import type { TuningGridResponse } from '@/services/tuning-grid'

vi.mock('@/services/tuning-grid', () => ({
  tuningGridService: { get: vi.fn() },
}))
import { tuningGridService } from '@/services/tuning-grid'
import { useTuningVariantCounts } from '../use-tuning-variant-counts'

type Props = Parameters<typeof useTuningVariantCounts>[0]

const ridgeGrid: TuningGridResponse = {
  algorithm: 'ridge',
  variants: [{ alpha: 3 }, { alpha: 10 }, { alpha: 30 }, { alpha: 100 }],
  maxVariantsPerJob: 4,
  tier: 'medium',
  sized: false,
}
const xgbGrid: TuningGridResponse = {
  ...ridgeGrid,
  algorithm: 'xgboost',
  variants: [{ n_estimators: 1 }, { n_estimators: 2 }],
}

function props(overrides: Partial<Props> = {}): Props {
  return {
    enabled: true,
    algorithms: ['ridge', 'xgboost'] as Algorithm[],
    hyperparameters: { alpha: 1 } as Record<string, HyperparamValue>,
    perAlgorithmHyperparameters: {},
    size: { rows: 5000 },
    ...overrides,
  }
}

beforeEach(() => {
  vi.mocked(tuningGridService.get).mockReset()
  vi.mocked(tuningGridService.get).mockImplementation(a =>
    Promise.resolve(a === 'ridge' ? ridgeGrid : xgbGrid),
  )
})

describe('useTuningVariantCounts (MODEL-FLOW-025-T06/T07)', () => {
  it('is empty, and fetches nothing, while disabled', () => {
    const { result } = renderHook(() =>
      useTuningVariantCounts(props({ enabled: false })),
    )
    expect(result.current).toEqual({})
    expect(tuningGridService.get).not.toHaveBeenCalled()
  })

  it('counts each selected algorithm’s variants, capped', async () => {
    const { result } = renderHook(() => useTuningVariantCounts(props()))
    await waitFor(() =>
      expect(result.current).toEqual({ ridge: 4, xgboost: 2 }),
    )
    expect(tuningGridService.get).toHaveBeenCalledWith('ridge', {
      rows: 5000,
      features: null,
    })
  })

  it('recounts from the base on every edit without another request', async () => {
    const { result, rerender } = renderHook(p => useTuningVariantCounts(p), {
      initialProps: props(),
    })
    await waitFor(() => expect(result.current.ridge).toBe(4))
    const calls = vi.mocked(tuningGridService.get).mock.calls.length

    // Primary ridge now equals one variant: the search would skip it.
    rerender(props({ hyperparameters: { alpha: 10 } }))
    await waitFor(() => expect(result.current.ridge).toBe(3))
    expect(tuningGridService.get).toHaveBeenCalledTimes(calls)
  })

  it('fills a partial record with defaults before counting (T05)', async () => {
    const d = defaultHyperparams('xgboost')
    const target = { ...d, n_estimators: 777 }
    vi.mocked(tuningGridService.get).mockResolvedValue({
      ...xgbGrid,
      variants: [target, { ...d, n_estimators: 50 }],
    })
    const { result } = renderHook(() =>
      useTuningVariantCounts(
        props({
          algorithms: ['xgboost'] as Algorithm[],
          hyperparameters: { n_estimators: 777 },
        }),
      ),
    )
    await waitFor(() => expect(result.current.xgboost).toBe(1))
  })

  it('leaves out an algorithm whose grid failed, so the estimate falls back to the cap', async () => {
    vi.mocked(tuningGridService.get).mockImplementation(a =>
      a === 'ridge' ? Promise.resolve(ridgeGrid) : Promise.reject(new Error()),
    )
    const { result } = renderHook(() => useTuningVariantCounts(props()))
    await waitFor(() => expect(result.current).toEqual({ ridge: 4 }))
  })
})
