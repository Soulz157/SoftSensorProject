import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { RunPredictions } from '@/services/model-draft'
import type { RetrainCriterion } from '@/lib/acceptance-criteria'

// Two lab events held 2 rows each. New version 1 off at both; current 3 off.
const Y = [100, 100, 110, 110]
const series = (off: number): RunPredictions => ({
  sourceKey: 'k',
  rowCount: Y.length,
  residualSd: 0,
  residualRmseCheck: 0,
  yTrueMin: 100,
  yTrueMax: 110,
  yPredMin: 0,
  yPredMax: 0,
  points: Y.map((y, i) => ({
    timestamp: new Date(Date.UTC(2026, 0, 1, i)).toISOString(),
    yTrue: y,
    yPred: y + off,
  })),
  derivedFromTarget: null,
  targetScaled: null,
})

vi.mock('@/services/model-retrain', async importOriginal => {
  const actual =
    await importOriginal<typeof import('@/services/model-retrain')>()
  return {
    ...actual,
    modelRunPredictionsService: {
      get: vi.fn(async (_m: string, _r: string, population: string) => ({
        statusCode: 200,
        message: 'ok',
        type: 'SUCCESS' as const,
        data: series(population === 'current_new_data_holdout' ? 3 : 1),
      })),
    },
  }
})

import {
  RetrainCriteriaPicker,
  RetrainCriteriaVerdicts,
} from '../retrain-criteria'

describe('RetrainCriteriaPicker (MODEL-SERVE-026-T07)', () => {
  it('offers the two criteria, none ticked, and reports a tick upward', async () => {
    const onChange = vi.fn()
    render(<RetrainCriteriaPicker value={[]} onChange={onChange} />)
    const boxes = screen.getAllByRole('checkbox')
    expect(boxes).toHaveLength(2)
    expect(boxes.every(b => b.getAttribute('aria-checked') === 'false')).toBe(
      true,
    )
    expect(screen.queryByRole('spinbutton')).toBeNull() // no number to type
    await userEvent.click(
      screen.getByText('New version R² ≥ 0 on the shared window'),
    )
    expect(onChange).toHaveBeenCalledWith([{ kind: 'retrain-r2-floor' }])
  })
})

describe('RetrainCriteriaVerdicts (MODEL-SERVE-026-T07)', () => {
  it('states each verdict with both readings, at lab events', async () => {
    const criteria: RetrainCriterion[] = [
      {
        kind: 'retrain-comparison',
        left: {
          metric: 'rmse',
          subject: 'candidate',
          population: 'shared-window',
        },
        operator: 'lt',
        right: {
          metric: 'rmse',
          subject: 'current',
          population: 'shared-window',
        },
      },
      { kind: 'retrain-r2-floor' },
    ]
    render(
      <RetrainCriteriaVerdicts
        modelId="m-crit"
        candidateRunId="cand"
        criteria={criteria}
      />,
    )
    expect(
      await screen.findByText(/New version RMSE < Current version RMSE/),
    ).toHaveTextContent(
      'Pass — New version RMSE < Current version RMSE on the shared window: 1.000 vs 3.000',
    )
    // R² at 2 events: SS_tot = 50, SS_res = 2 -> 0.96.
    expect(screen.getByText(/R² ≥ 0/)).toHaveTextContent('Pass')
    // A held criterion reads green; the word stays beside the colour.
    for (const pass of screen.getAllByText('Pass')) {
      expect(pass).toHaveClass('text-green-600')
    }
  })
})
