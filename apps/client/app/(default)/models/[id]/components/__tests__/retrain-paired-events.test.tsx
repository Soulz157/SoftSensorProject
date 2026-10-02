import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import type { RunPredictions } from '@/services/model-draft'

// V01's shape: per event [new error, current error]. One LARGE new-version
// win, one small one, seven losses — the new version wins on MEAN error while
// losing 7 of 9 events. Each event held for 2 rows, y_true stepping by 10.
const V01: [number, number][] = [
  [0, 30],
  [1, 2],
  ...Array.from({ length: 7 }, (): [number, number] => [2, 1]),
]
// 20 events, every one a new-version win.
const MANY: [number, number][] = Array.from({ length: 20 }, () => [0, 1])

const series = (errors: [number, number][], side: 0 | 1): RunPredictions => {
  const points = errors.flatMap(([c, o], e) =>
    [0, 1].map(r => ({
      timestamp: new Date(Date.UTC(2026, 0, 1, e * 2 + r)).toISOString(),
      yTrue: 100 + e * 10,
      yPred: 100 + e * 10 + (side === 0 ? c : o),
    })),
  )
  return {
    sourceKey: 'k',
    rowCount: points.length,
    residualSd: 0,
    residualRmseCheck: 0,
    yTrueMin: 0,
    yTrueMax: 0,
    yPredMin: 0,
    yPredMax: 0,
    points,
    derivedFromTarget: null,
    targetScaled: null,
  }
}

vi.mock('@/services/model-retrain', async importOriginal => {
  const actual =
    await importOriginal<typeof import('@/services/model-retrain')>()
  return {
    ...actual,
    modelRunPredictionsService: {
      get: vi.fn(async (modelId: string, _r: string, population: string) => ({
        statusCode: 200,
        message: 'ok',
        type: 'SUCCESS' as const,
        data: series(
          modelId === 'many' ? MANY : V01,
          population === 'current_new_data_holdout' ? 1 : 0,
        ),
      })),
    },
  }
})

import { RetrainPairedEvents } from '../retrain-paired-events'

describe('RetrainPairedEvents (MODEL-SERVE-026-T04)', () => {
  it('V01 — reports the win count and shows every event, so a mean carried by one large win cannot pass as the result', async () => {
    render(
      <RetrainPairedEvents
        ids={{
          modelId: 'v01',
          candidateRunId: 'cand',
          incumbentSourceRunId: 'inc',
        }}
        currentVersion={1}
      />,
    )
    const summary = await screen.findByText(/The new version was closer on/)
    expect(summary).toHaveTextContent(
      'The new version was closer on 2 of 9 lab events; current v1 was closer on 7.',
    )
    // 9 <= 15: the table is the result, shown open — 9 event rows + header.
    const table = screen.getByRole('table')
    expect(within(table).getAllByRole('row')).toHaveLength(10)
    expect(within(table).getAllByText('Current')).toHaveLength(7 + 1) // 7 rows + header
    // No mean and no interval presented as the result.
    expect(screen.queryByText(/mean error (improved|regressed)/i)).toBeNull()
    expect(
      screen.getByText(/No confidence interval is given/),
    ).toBeInTheDocument()
  })

  it('above the small-count line the table starts collapsed, one click away', async () => {
    render(
      <RetrainPairedEvents
        ids={{
          modelId: 'many',
          candidateRunId: 'cand',
          incumbentSourceRunId: 'inc',
        }}
        currentVersion={1}
      />,
    )
    expect(await screen.findByText(/closer on/)).toHaveTextContent(
      'closer on 20 of 20 lab events',
    )
    expect(screen.queryByRole('table')).toBeNull()
    expect(
      screen.getByRole('button', { name: 'Show all 20 events' }),
    ).toBeInTheDocument()
  })
})
