import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { CleaningStep } from '@/lib/preprocessing'
import { ImputationDetailPanel } from '../imputation-detail-panel'

vi.mock('../imputation-trend-chart', () => ({
  ImputationTrendChart: () => null,
}))
vi.mock('../imputation-comparison-histogram', () => ({
  ImputationComparisonHistogram: () => null,
}))

function renderPanel(
  over: Partial<React.ComponentProps<typeof ImputationDetailPanel>> = {},
) {
  const onPipelineChange = vi.fn<(next: CleaningStep[]) => void>()
  const onPreviewIndexChange = vi.fn()
  render(
    <ImputationDetailPanel
      pipeline={[]}
      onPipelineChange={onPipelineChange}
      previewIndex={0}
      onPreviewIndexChange={onPreviewIndexChange}
      previewRows={[]}
      cleaningTags={['FI-1', 'TI-2']}
      isolatedTag="FI-1"
      onIsolate={vi.fn()}
      dataBounds={null}
      {...over}
    />,
  )
  return { onPipelineChange, onPreviewIndexChange }
}

const interpolate: CleaningStep = {
  uid: 'i',
  category: 'missing',
  method: 'interpolate',
}

describe('ImputationDetailPanel — zeros as missing', () => {
  it('says nothing without a suggestion', () => {
    renderPanel()
    expect(screen.queryByText(/read(s)? exactly 0 often/)).toBeNull()
  })

  it('names the tags and inserts one scoped exclude [0, 0] step FIRST', async () => {
    const { onPipelineChange, onPreviewIndexChange } = renderPanel({
      pipeline: [interpolate],
      zeroSuggestions: [
        { tag: 'FI-1', zeros: 120, readings: 1000, share: 0.12 },
      ],
    })
    expect(screen.getByText('1 tag reads exactly 0 often')).toBeInTheDocument()
    expect(
      screen.getByTitle('120 of 1,000 loaded readings are exactly 0'),
    ).toHaveTextContent('FI-1 12%')

    await userEvent.click(
      screen.getByRole('button', { name: 'Treat zeros as missing' }),
    )
    const next = onPipelineChange.mock.calls[0]![0]
    expect(next).toHaveLength(2)
    expect(next[0]).toMatchObject({
      method: 'exclude',
      paramLow: 0,
      param: 0,
      tags: ['FI-1'],
    })
    expect(next[1]).toBe(interpolate)
    expect(onPreviewIndexChange).toHaveBeenCalledWith(2)
  })
})

describe('ImputationDetailPanel — interpolate max gap', () => {
  it('offers an optional Max gap that reads "no limit" when blank', async () => {
    const { onPipelineChange } = renderPanel({ pipeline: [interpolate] })
    const input = screen.getByLabelText('Max gap')
    expect(input).toHaveAttribute('placeholder', 'no limit')
    expect(input).toHaveValue(null)

    await userEvent.type(input, '3')
    expect(onPipelineChange).toHaveBeenLastCalledWith([
      { ...interpolate, param: 3 },
    ])
  })
})
