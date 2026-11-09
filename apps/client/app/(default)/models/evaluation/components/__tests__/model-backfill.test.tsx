import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { AIModel } from '@/types'
import type { UseModelEvaluation } from '@/hooks/use-model-backfill'
import type { EvaluationCompareResult } from '@/services/model-backfill'
import { ModelEvaluation } from '../model-backfill'

/**
 * MODEL-SERVE-032. The Evaluation page's states, with the data hook mocked
 * and the two chart components stubbed (recharts needs a layout engine; the
 * chart math is covered by lib/backfill-compare.test.ts). What is pinned
 * here is what the page SAYS: that a skipped row, a missing lab, an absent
 * import and a server refusal each read as themselves.
 */
const hook = vi.fn<() => UseModelEvaluation>()
vi.mock('@/hooks/use-model-backfill', () => ({
  useModelEvaluation: () => hook(),
}))
vi.mock('../backfill-chart', () => ({
  EvaluationChart: () => <div data-testid="chart" />,
  EVALUATION_SYNC_ID: 'evaluation',
}))
vi.mock('../backfill-x-panel', () => ({
  EvaluationXPanel: () => <div data-testid="x-panel" />,
}))
vi.mock('../lab-editor', () => ({
  LabEditor: () => <div data-testid="lab-editor" />,
}))
vi.mock('../write-back-card', () => ({
  WriteBackCard: () => <div data-testid="write-back-card" />,
}))

const MODEL = { id: 'm1', name: 'Boiler soft sensor' } as unknown as AIModel

function data(
  over: Partial<EvaluationCompareResult> = {},
): EvaluationCompareResult {
  return {
    modelVersionId: 'v1',
    version: 3,
    targetTag: 'LAB.Y',
    featureColumns: ['A'],
    interval: '1m',
    toleranceMinutes: 30,
    range: { from: '2026-10-14T00:00:00.000Z', to: '2026-10-14T01:00:00.000Z' },
    counts: { rows: 1440, scored: 1422, skipped: 18 },
    points: [],
    features: {},
    lab: { supported: true, events: [], truncated: false, error: null },
    ...over,
  }
}

function state(over: Partial<UseModelEvaluation> = {}): UseModelEvaluation {
  return {
    from: '2026-10-13T12:00',
    to: '2026-10-14T12:00',
    setFrom: vi.fn(),
    setTo: vi.fn(),
    rangeError: null,
    importRange: vi.fn().mockResolvedValue(undefined),
    loading: false,
    error: null,
    data: null,
    rows: [],
    pairs: [],
    metrics: { rmse: 0, mae: 0, r2: 0, bias: 0, n: 0 },
    labPoints: [],
    labRows: [],
    labChanges: 0,
    addLab: vi.fn(),
    editLab: vi.fn(),
    removeLab: vi.fn(),
    restoreLab: vi.fn(),
    importLabCsv: vi.fn(() => ({ added: 0, errors: [] })),
    resetLab: vi.fn(),
    ...over,
  }
}

beforeEach(() => {
  hook.mockReset()
})

describe('ModelEvaluation', () => {
  it('before any import: says what to do, shows no chart and no fabricated numbers', () => {
    hook.mockReturnValue(state())
    render(<ModelEvaluation model={MODEL} />)
    expect(
      screen.getByText(/Import from data source/, { selector: 'button' }),
    ).toBeInTheDocument()
    expect(screen.getByText(/Pick a range and choose/)).toBeInTheDocument()
    expect(screen.queryByTestId('chart')).not.toBeInTheDocument()
    expect(screen.queryByText('RMSE')).not.toBeInTheDocument()
  })

  it('states the plant timezone the pickers speak', () => {
    hook.mockReturnValue(state())
    render(<ModelEvaluation model={MODEL} />)
    expect(screen.getByText(/plant time \(UTC\+7\)/)).toBeInTheDocument()
  })

  it('clicking Import asks the hook to import', async () => {
    const importRange = vi.fn().mockResolvedValue(undefined)
    hook.mockReturnValue(state({ importRange }))
    render(<ModelEvaluation model={MODEL} />)
    await userEvent.click(
      screen.getByRole('button', { name: /Import from data source/ }),
    )
    expect(importRange).toHaveBeenCalledTimes(1)
  })

  it('a bad range disables Import and says why', () => {
    hook.mockReturnValue(
      state({ rangeError: 'The end must be after the start.' }),
    )
    render(<ModelEvaluation model={MODEL} />)
    expect(
      screen.getByRole('button', { name: /Import from data source/ }),
    ).toBeDisabled()
    expect(
      screen.getByText('The end must be after the start.'),
    ).toBeInTheDocument()
  })

  it("shows the server's refusal verbatim", () => {
    hook.mockReturnValue(
      state({
        error:
          'This range is about 2880 rows at a 1m interval; the limit is 2000. Narrow the range.',
      }),
    )
    render(<ModelEvaluation model={MODEL} />)
    expect(screen.getByRole('alert')).toHaveTextContent(
      /limit is 2000. Narrow the range./,
    )
  })

  it('while importing: the button is disabled and reads Importing…', () => {
    hook.mockReturnValue(state({ loading: true }))
    render(<ModelEvaluation model={MODEL} />)
    expect(screen.getByRole('button', { name: /Importing/ })).toBeDisabled()
  })

  it('after an import: target tag, version, and the scored / not-scored counts', () => {
    hook.mockReturnValue(state({ data: data() }))
    render(<ModelEvaluation model={MODEL} />)
    expect(screen.getByText('LAB.Y')).toBeInTheDocument()
    expect(screen.getByText(/Version 3 · PRODUCTION/)).toBeInTheDocument()
    expect(screen.getByText(/1,422 scored/)).toBeInTheDocument()
    expect(
      screen.getByText(/18 not scored \(an input was not Good\)/),
    ).toBeInTheDocument()
    expect(screen.getByTestId('chart')).toBeInTheDocument()
    expect(screen.getByTestId('x-panel')).toBeInTheDocument()
    expect(screen.getByTestId('lab-editor')).toBeInTheDocument()
  })

  it('offers write-back even before any import (tags can be set first)', () => {
    hook.mockReturnValue(state())
    render(<ModelEvaluation model={MODEL} />)
    expect(screen.getByTestId('write-back-card')).toBeInTheDocument()
  })

  it('omits the not-scored clause when every row was scored', () => {
    hook.mockReturnValue(
      state({ data: data({ counts: { rows: 10, scored: 10, skipped: 0 } }) }),
    )
    render(<ModelEvaluation model={MODEL} />)
    expect(screen.queryByText(/not scored/)).not.toBeInTheDocument()
  })

  it('with no lab values: says so and does NOT show zeroed metrics', () => {
    hook.mockReturnValue(state({ data: data(), labPoints: [] }))
    render(<ModelEvaluation model={MODEL} />)
    expect(screen.getByText(/No lab values in this range/)).toBeInTheDocument()
    expect(screen.queryByText('RMSE')).not.toBeInTheDocument()
  })

  it('with lab values but too few pairs: names the tolerance', () => {
    hook.mockReturnValue(
      state({
        data: data(),
        labPoints: [{ timestamp: '2026-10-14T00:00:00.000Z', value: 1 }],
      }),
    )
    render(<ModelEvaluation model={MODEL} />)
    expect(screen.getByText(/within 30 min/)).toBeInTheDocument()
  })

  it('with enough pairs: shows the metric cards', () => {
    const pair = (n: number) => ({
      timestamp: `2026-10-14T00:0${n}:00.000Z`,
      predicted: 10,
      actual: 9,
      residual: 1,
    })
    hook.mockReturnValue(
      state({
        data: data(),
        pairs: [pair(0), pair(1)],
        metrics: { rmse: 1, mae: 1, r2: 0.9, bias: 1, n: 2 },
        labPoints: [
          { timestamp: '2026-10-14T00:00:00.000Z', value: 9 },
          { timestamp: '2026-10-14T00:01:00.000Z', value: 9 },
        ],
      }),
    )
    render(<ModelEvaluation model={MODEL} />)
    expect(screen.getByText('RMSE')).toBeInTheDocument()
    expect(screen.getByText('R²')).toBeInTheDocument()
  })

  it('says why lab values are missing instead of leaving a silent empty chart', () => {
    hook.mockReturnValue(
      state({
        data: data({
          lab: {
            supported: true,
            events: [],
            truncated: false,
            error: 'Could not read lab values for LAB.Y: PI down',
          },
        }),
      }),
    )
    render(<ModelEvaluation model={MODEL} />)
    expect(
      screen.getByText(/Could not read lab values for LAB.Y: PI down/),
    ).toBeInTheDocument()
  })

  it('warns when the lab read was truncated', () => {
    hook.mockReturnValue(
      state({
        data: data({
          lab: { supported: true, events: [], truncated: true, error: null },
        }),
      }),
    )
    render(<ModelEvaluation model={MODEL} />)
    expect(screen.getByText(/more events than were read/)).toBeInTheDocument()
  })

  it('no longer offers the mock AI analysis', () => {
    hook.mockReturnValue(state({ data: data() }))
    render(<ModelEvaluation model={MODEL} />)
    expect(screen.queryByText(/AI Analysis/i)).not.toBeInTheDocument()
  })
})
