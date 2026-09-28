import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import type { RunPredictions } from '@/services/model-draft'
import type { RetrainChartDataSet } from '@/lib/retrain-series'

const get = vi.fn()

vi.mock('@/services/model-retrain', () => ({
  modelRunPredictionsService: {
    get: (...a: unknown[]) => get(...a),
  },
}))

import { useRetrainPredictions } from '../use-retrain-predictions'

function preds(rows: { t: number; yTrue: number; yPred: number }[]): {
  data: RunPredictions
} {
  return {
    data: {
      sourceKey: 'k',
      rowCount: rows.length,
      residualSd: 0.5,
      residualRmseCheck: 0.5,
      yTrueMin: 0,
      yTrueMax: 0,
      yPredMin: 0,
      yPredMax: 0,
      points: rows.map(r => ({
        timestamp: `2026-01-01 ${String(r.t).padStart(2, '0')}:00:00`,
        yTrue: r.yTrue,
        yPred: r.yPred,
      })),
      derivedFromTarget: null,
      targetScaled: false,
    },
  }
}

const BASE = {
  modelId: 'model-1',
  candidateRunId: 'run-new',
  candidatePopulation: 'holdout' as const,
  currentRunId: 'run-current',
  currentLabel: 'Current v3',
  enabled: true,
}

function render(dataSet: RetrainChartDataSet, overrides = {}) {
  return renderHook(
    (p: { dataSet: RetrainChartDataSet }) =>
      useRetrainPredictions({ ...BASE, ...overrides, dataSet: p.dataSet }),
    { initialProps: { dataSet } },
  )
}

beforeEach(() => {
  get.mockReset()
})

describe('useRetrainPredictions', () => {
  it('stays idle and fetches nothing while disabled or with no run', () => {
    const a = render('CURRENT_TEST', { enabled: false })
    expect(a.result.current.status).toBe('idle')
    const b = render('CURRENT_TEST', { candidateRunId: null })
    expect(b.result.current.status).toBe('idle')
    expect(get).not.toHaveBeenCalled()
  })

  it('CURRENT_TEST reads the new version’s holdout and the current version’s test series, overlaid on shared rows', async () => {
    get.mockImplementation((_m: string, runId: string, pop: string) => {
      if (runId === 'run-new' && pop === 'holdout')
        return Promise.resolve(preds([{ t: 5, yTrue: 5, yPred: 5.1 }]))
      if (runId === 'run-current' && pop === 'test')
        return Promise.resolve(
          preds([
            { t: 0, yTrue: 0, yPred: 90 },
            { t: 5, yTrue: 5, yPred: 4 },
          ]),
        )
      return Promise.reject(new Error('unexpected read'))
    })

    const { result } = render('CURRENT_TEST')
    expect(result.current.status).toBe('loading')
    await waitFor(() => expect(result.current.status).toBe('ready'))

    expect(get).toHaveBeenCalledWith('model-1', 'run-new', 'holdout')
    expect(get).toHaveBeenCalledWith('model-1', 'run-current', 'test')
    expect(result.current.series?.rows[0]?.comparePredict).toBe(4)
    expect(result.current.series?.overlayNote).toMatch(/Current v3/)
    expect(result.current.overlayError).toBeNull()
  })

  it('still draws the new version, and says why, when the current version’s series cannot be read', async () => {
    get.mockImplementation((_m: string, runId: string) =>
      runId === 'run-new'
        ? Promise.resolve(preds([{ t: 5, yTrue: 5, yPred: 5.1 }]))
        : Promise.reject(
            new Error(
              'Training run succeeded but recorded no test predictions artifact.',
            ),
          ),
    )

    const { result } = render('CURRENT_TEST')
    await waitFor(() => expect(result.current.status).toBe('ready'))

    expect(result.current.series?.rows).toHaveLength(1)
    expect(result.current.series?.rows[0]?.comparePredict).toBeNull()
    expect(result.current.overlayError).toBe(
      'Training run succeeded but recorded no test predictions artifact.',
    )
  })

  it('reports the server’s own reason, and no series, when the new version’s read fails', async () => {
    get.mockRejectedValue(
      new Error(
        'Training run succeeded but recorded no holdout predictions artifact.',
      ),
    )

    const { result } = render('CURRENT_TEST')
    await waitFor(() => expect(result.current.status).toBe('error'))

    expect(result.current.series).toBeNull()
    expect(result.current.error).toBe(
      'Training run succeeded but recorded no holdout predictions artifact.',
    )
  })

  it('a legacy Keep Existing retrain reads the new version’s own test series', async () => {
    get.mockResolvedValue(preds([{ t: 1, yTrue: 1, yPred: 1 }]))
    const { result } = render('CURRENT_TEST', { candidatePopulation: 'test' })
    await waitFor(() => expect(result.current.status).toBe('ready'))
    expect(get).toHaveBeenCalledWith('model-1', 'run-new', 'test')
    expect(get).not.toHaveBeenCalledWith('model-1', 'run-new', 'holdout')
  })

  it('NEW_DATA reads only the new-data series and attempts no overlay', async () => {
    get.mockResolvedValue(preds([{ t: 1, yTrue: 1, yPred: 1.2 }]))

    const { result } = render('NEW_DATA')
    await waitFor(() => expect(result.current.status).toBe('ready'))

    expect(get).toHaveBeenCalledTimes(1)
    expect(get).toHaveBeenCalledWith('model-1', 'run-new', 'new_data_holdout')
    expect(result.current.series?.overlayNote).toBeNull()
  })

  it('surfaces the server reason when no new-data series was recorded', async () => {
    get.mockRejectedValue(
      new Error(
        'No predictions were recorded for the new data set aside in this retrain.',
      ),
    )

    const { result } = render('NEW_DATA')
    await waitFor(() => expect(result.current.status).toBe('error'))
    expect(result.current.error).toMatch(/new data set aside/)
  })

  it('shows loading — not the previous data set’s series — right after switching', async () => {
    get.mockResolvedValue(preds([{ t: 1, yTrue: 1, yPred: 1 }]))
    const { result, rerender } = render('CURRENT_TEST')
    await waitFor(() => expect(result.current.status).toBe('ready'))

    get.mockImplementation(() => new Promise(() => {})) // never settles
    rerender({ dataSet: 'NEW_DATA' })

    expect(result.current.status).toBe('loading')
    expect(result.current.series).toBeNull()
  })
})
